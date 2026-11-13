import {
  clockSeconds,
  pauseClock,
  resumeClock,
  startClock,
  type RecordClock,
} from "../capture/capture-rules";
import { defaultDeviceSource, openMediaStream } from "../capture/devices";
import { WARMUP_MS, videoBitrate, videoConstraints } from "../capture/video/video-quality";
import { delay, makeObjectUrl, revokeObjectUrl, stopTracks } from "./media_shared";

/**
 * video_capture 的录制机制：开流、预热、录像、暂停、本地回放地址、停止。
 * 只管行为，不管界面；界面在 video_capture_kind.ts。
 */

export interface VideoRecorderEvents {
  onStart(): void;
  onPause(): void;
  onResume(): void;
  /** 录制中的秒数，250ms 一次。 */
  onTick(seconds: number): void;
  /** 一段录完了；卸载之后也可能回调（调用方按"录了即存"决定提交）。 */
  onEnd(blob: Blob, seconds: number): void;
}

export interface VideoRecorder {
  start(quality: string, deviceId: string | undefined): Promise<void>;
  stop(): void;
  pause(): void;
  resume(): void;
  isActive(): boolean;
  /** 录制中的实时流；不在录就是 null。 */
  stream(): MediaStream | null;
  /** 刚录完的本地回放地址；没有就是 undefined。 */
  previewUrl(): string | undefined;
  clearPreview(): void;
  seconds(): number;
  dispose(): void;
}

class Recorder implements VideoRecorder {
  private streamValue: MediaStream | null = null;
  private media: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private clock: RecordClock = startClock(Date.now());
  private secondsValue = 0;
  private ticker: number | null = null;
  private preview: string | undefined;
  private starting = false;
  private disposed = false;

  constructor(private readonly events: VideoRecorderEvents) {}

  async start(quality: string, deviceId: string | undefined): Promise<void> {
    if (this.starting || this.disposed) {
      return;
    }
    this.starting = true;
    this.clearPreview();
    try {
      const opened = await openMediaStream(defaultDeviceSource(), {
        video: videoConstraints(quality, deviceId),
        audio: false,
      });
      if (this.disposed) {
        stopTracks(opened);
        return;
      }
      this.streamValue = opened;
      // 先让 ISP 收敛，别把开头那次亮度跳变录进去（legacy 的预热）。
      await delay(WARMUP_MS);
      if (this.disposed) {
        this.release();
        return;
      }
      const Ctor = window.MediaRecorder;
      if (typeof Ctor !== "function") {
        this.release();
        throw new Error("浏览器不支持 MediaRecorder");
      }
      this.chunks = [];
      const media = new Ctor(opened, {
        videoBitsPerSecond: videoBitrate(quality),
      });
      media.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.chunks.push(event.data);
        }
      };
      media.onstop = () => {
        this.settle(media);
      };
      this.media = media;
      this.clock = startClock(Date.now());
      this.secondsValue = 0;
      media.start();
      this.startTicker();
      if (!this.disposed) {
        this.events.onStart();
      }
    } catch (error) {
      this.release();
      throw error;
    } finally {
      this.starting = false;
    }
  }

  stop(): void {
    const active = this.media;
    if (active !== null && active.state !== "inactive") {
      active.stop();
    }
  }

  pause(): void {
    const active = this.media;
    if (active === null || active.state !== "recording") {
      return;
    }
    active.pause();
    this.clock = pauseClock(this.clock, Date.now());
    this.events.onPause();
  }

  resume(): void {
    const active = this.media;
    if (active === null || active.state !== "paused") {
      return;
    }
    active.resume();
    this.clock = resumeClock(this.clock, Date.now());
    this.events.onResume();
  }

  isActive(): boolean {
    return this.media !== null && this.media.state !== "inactive";
  }

  stream(): MediaStream | null {
    return this.streamValue;
  }

  previewUrl(): string | undefined {
    return this.preview;
  }

  seconds(): number {
    return this.secondsValue;
  }

  clearPreview(): void {
    revokeObjectUrl(this.preview);
    this.preview = undefined;
  }

  dispose(): void {
    this.disposed = true;
    this.stopTicker();
    this.clearPreview();
    const active = this.media;
    if (active !== null && active.state !== "inactive") {
      // 还在录：停下来，onstop 里按"录了即存"把这段交出去。
      active.stop();
      return;
    }
    this.release();
  }

  private settle(media: MediaRecorder): void {
    this.stopTicker();
    this.releaseStream();
    this.media = null;
    this.secondsValue = clockSeconds(this.clock, Date.now());
    const blob = new Blob(this.chunks, { type: media.mimeType || "video/webm" });
    this.chunks = [];
    if (!this.disposed) {
      this.showPreview(blob);
    }
    this.events.onEnd(blob, this.secondsValue);
  }

  private showPreview(blob: Blob): void {
    const url = makeObjectUrl(blob);
    if (url !== undefined) {
      this.preview = url;
    }
  }

  private startTicker(): void {
    this.stopTicker();
    this.ticker = window.setInterval(() => {
      this.secondsValue = clockSeconds(this.clock, Date.now());
      if (!this.disposed) {
        this.events.onTick(this.secondsValue);
      }
    }, 250);
  }

  private stopTicker(): void {
    if (this.ticker !== null) {
      window.clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  private release(): void {
    this.releaseStream();
    this.stopTicker();
  }

  private releaseStream(): void {
    stopTracks(this.streamValue);
    this.streamValue = null;
  }
}

export function createVideoRecorder(events: VideoRecorderEvents): VideoRecorder {
  return new Recorder(events);
}
