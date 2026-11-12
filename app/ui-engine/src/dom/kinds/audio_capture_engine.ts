import {
  clockSeconds,
  pauseClock,
  resumeClock,
  startClock,
  type RecordClock,
} from "../../capture/capture-rules";
import { defaultDeviceSource, openMediaStream } from "../../capture/devices";
import type WaveSurfer from "wavesurfer.js";
import type RecordPlugin from "wavesurfer.js/dist/plugins/record.js";
import { loadWaveSurfer, stopTracks, WAVE_COLOR, WAVE_PROGRESS_COLOR } from "./media_shared";

/**
 * audio_capture 的录制引擎：优先用 v1 同款 wavesurfer record 插件
 * （滚动实时波形 + 录音 / 暂停 / 时长都由插件给）。
 *
 * 波形库加载失败（或环境没有 WebAudio / Canvas）时降级成裸 MediaRecorder：
 * 录得到、传得出，只是不画实时波形。降级路径同样可测。
 */

/** 实时波形看最近多少秒（v1 同值）。 */
const WAVE_WINDOW_SECONDS = 10;

export interface AudioCaptureEvents {
  /** 录制进度，秒。 */
  onProgress(seconds: number): void;
  /** 插件确认的录制 / 暂停态。 */
  onPhase(phase: "recording" | "paused"): void;
  /** 一段录完了；卸载之后也可能回调（调用方按"录了即存"决定提交）。 */
  onEnd(blob: Blob, seconds: number): void;
  /** 录制引擎就绪（成功或降级都算就绪）。 */
  onReady(): void;
}

export interface AudioCaptureEngine {
  start(deviceId: string | undefined): Promise<void>;
  stop(): void;
  pause(): void;
  resume(): void;
  isActive(): boolean;
  dispose(): void;
}

type Backend = "loading" | "wavesurfer" | "media";

let recordPluginLoading: Promise<typeof RecordPlugin> | null = null;

/** record 插件同波形库一样按需拉取，只拉一次。 */
function loadRecordPlugin(): Promise<typeof RecordPlugin> {
  if (recordPluginLoading === null) {
    recordPluginLoading = import("wavesurfer.js/dist/plugins/record.js").then(
      (module) => module.default,
    );
  }
  return recordPluginLoading;
}

class Engine implements AudioCaptureEngine {
  private backend: Backend = "loading";
  private wave: WaveSurfer | null = null;
  private plugin: RecordPlugin | null = null;
  private media: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private clock: RecordClock = startClock(Date.now());
  private ticker: number | null = null;
  private seconds = 0;
  private disposed = false;
  private readonly ready: Promise<void>;

  constructor(
    private readonly container: HTMLElement,
    private readonly bitsPerSecond: number,
    private readonly events: AudioCaptureEvents,
  ) {
    this.ready = this.load();
  }

  async start(deviceId: string | undefined): Promise<void> {
    await this.ready;
    if (this.disposed) {
      return;
    }
    if (this.backend === "wavesurfer") {
      await this.startPlugin(deviceId);
      return;
    }
    await this.startMedia(deviceId);
  }

  stop(): void {
    if (this.plugin !== null) {
      this.plugin.stopRecording();
      return;
    }
    const active = this.media;
    if (active !== null && active.state !== "inactive") {
      active.stop();
    }
  }

  pause(): void {
    if (this.plugin !== null) {
      this.plugin.pauseRecording();
      return;
    }
    const active = this.media;
    if (active === null || active.state !== "recording") {
      return;
    }
    active.pause();
    this.clock = pauseClock(this.clock, Date.now());
    this.events.onPhase("paused");
  }

  resume(): void {
    if (this.plugin !== null) {
      this.plugin.resumeRecording();
      return;
    }
    const active = this.media;
    if (active === null || active.state !== "paused") {
      return;
    }
    active.resume();
    this.clock = resumeClock(this.clock, Date.now());
    this.events.onPhase("recording");
  }

  isActive(): boolean {
    if (this.plugin !== null) {
      return this.plugin.isActive();
    }
    return this.media !== null && this.media.state !== "inactive";
  }

  dispose(): void {
    this.disposed = true;
    this.stopTicker();
    if (this.plugin !== null) {
      if (this.plugin.isActive()) {
        // 还在录：停下来，等 record-end 交完这段再销毁（v1 的卸载即提交）。
        try {
          this.plugin.stopRecording();
        } catch (error) {
          console.error("[omora] 停止录音失败:", error);
          this.destroyWave();
        }
        return;
      }
      this.destroyWave();
      return;
    }
    const active = this.media;
    if (active !== null && active.state !== "inactive") {
      active.stop();
      return;
    }
    this.releaseStream();
  }

  private async load(): Promise<void> {
    try {
      const [WaveSurferCtor, RecordCtor] = await Promise.all([
        loadWaveSurfer(),
        loadRecordPlugin(),
      ]);
      if (this.disposed) {
        return;
      }
      const wave = WaveSurferCtor.create({
        container: this.container,
        height: 56,
        waveColor: WAVE_COLOR,
        progressColor: WAVE_PROGRESS_COLOR,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        cursorWidth: 0,
        interact: false,
        normalize: true,
      });
      const plugin = wave.registerPlugin(
        RecordCtor.create({
          mimeType: "audio/webm",
          audioBitsPerSecond: this.bitsPerSecond,
          scrollingWaveform: true,
          scrollingWaveformWindow: WAVE_WINDOW_SECONDS,
          renderRecordedAudio: false,
        }),
      );
      plugin.on("record-progress", (millis: number) => {
        if (!this.disposed) {
          this.events.onProgress(millis / 1000);
        }
      });
      plugin.on("record-pause", () => {
        if (!this.disposed) {
          this.events.onPhase("paused");
        }
      });
      plugin.on("record-resume", () => {
        if (!this.disposed) {
          this.events.onPhase("recording");
        }
      });
      plugin.on("record-end", (blob: Blob) => {
        this.finishPlugin(blob, plugin.getDuration() / 1000);
      });
      this.wave = wave;
      this.plugin = plugin;
      this.backend = "wavesurfer";
      this.events.onReady();
    } catch (error) {
      console.error("[omora] 实时波形不可用，退回 MediaRecorder:", error);
      if (this.disposed) {
        return;
      }
      this.backend = "media";
      this.events.onReady();
    }
  }

  private async startPlugin(deviceId: string | undefined): Promise<void> {
    const plugin = this.plugin;
    if (plugin === null) {
      throw new Error("实时波形未就绪");
    }
    await plugin.startRecording(deviceId === undefined ? {} : { deviceId: { ideal: deviceId } });
    if (!this.disposed) {
      this.events.onPhase("recording");
    }
  }

  private async startMedia(deviceId: string | undefined): Promise<void> {
    const opened = await openMediaStream(
      defaultDeviceSource(),
      deviceId === undefined ? { audio: true } : { audio: { deviceId: { ideal: deviceId } } },
    );
    if (this.disposed) {
      stopTracks(opened);
      return;
    }
    const Ctor = window.MediaRecorder;
    if (typeof Ctor !== "function") {
      stopTracks(opened);
      throw new Error("浏览器不支持 MediaRecorder");
    }
    this.stream = opened;
    this.chunks = [];
    const media = new Ctor(opened, {
      mimeType: "audio/webm",
      audioBitsPerSecond: this.bitsPerSecond,
    });
    media.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };
    media.onstop = () => {
      this.finishMedia(media);
    };
    this.media = media;
    this.clock = startClock(Date.now());
    this.seconds = 0;
    media.start();
    this.startTicker();
    this.events.onPhase("recording");
  }

  private finishPlugin(blob: Blob, seconds: number): void {
    if (this.disposed) {
      this.events.onEnd(blob, seconds);
      this.destroyWave();
      return;
    }
    this.events.onEnd(blob, seconds);
  }

  private finishMedia(media: MediaRecorder): void {
    this.stopTicker();
    this.releaseStream();
    this.media = null;
    const seconds = clockSeconds(this.clock, Date.now());
    const blob = new Blob(this.chunks, { type: media.mimeType || "audio/webm" });
    this.chunks = [];
    this.events.onEnd(blob, seconds);
  }

  private startTicker(): void {
    this.stopTicker();
    this.ticker = window.setInterval(() => {
      this.seconds = clockSeconds(this.clock, Date.now());
      if (!this.disposed) {
        this.events.onProgress(this.seconds);
      }
    }, 250);
  }

  private stopTicker(): void {
    if (this.ticker !== null) {
      window.clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  private releaseStream(): void {
    stopTracks(this.stream);
    this.stream = null;
  }

  private destroyWave(): void {
    const wave = this.wave;
    this.wave = null;
    this.plugin = null;
    if (wave === null) {
      return;
    }
    try {
      wave.destroy();
    } catch (error) {
      console.error("[omora] 波形销毁失败:", error);
    }
  }
}

export function createAudioCaptureEngine(
  container: HTMLElement,
  bitsPerSecond: number,
  events: AudioCaptureEvents,
): AudioCaptureEngine {
  return new Engine(container, bitsPerSecond, events);
}
