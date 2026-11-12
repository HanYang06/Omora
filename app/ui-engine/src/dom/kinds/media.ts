import {
  captureErrorReason,
  captureGate,
  createDeviceTracker,
  defaultDeviceSource,
  deviceLabel,
  openMediaStream,
  type DeviceInfo,
  type DeviceKind,
  type DeviceState,
  type DeviceTracker,
} from "../../capture/devices";
import {
  clockSeconds,
  pauseClock,
  planStop,
  resumeClock,
  startClock,
  timeUp,
  type RecordClock,
} from "../../capture/capture-rules";
import { uploadRecorded } from "../../capture/media-upload";
import {
  DEFAULT_SECONDS as VIDEO_DEFAULT_SECONDS,
  WARMUP_MS,
  videoBitrate,
  videoConstraints,
} from "../../capture/video/video-quality";
import type WaveSurfer from "wavesurfer.js";
import type { Node } from "../../core/types";
import { handlerOf } from "../events";
import type { KindRegistry, RenderContext } from "../types";

/**
 * 媒体 / 捕捉类 kind：recorder / audio / audio_capture / video_capture / video / waveform。
 *
 * 与 v1 的 React 实现保持同样的 markup（class / data-type / data-handler）与行为：
 * 元素只建一次，更新落在元素上；监听、定时器、流、媒体实例的清理都登记进
 * ctx.cleanup（renderer 卸载时逆序执行）。录制 / 上传的纯规则复用 capture/ 下现成的
 * capture-rules / devices / media-upload，不另写一套。
 */

const AUDIO_MAX_SECONDS = 600;
const AUDIO_BITS_PER_SECOND = 128_000;
const AUDIO_LOW_BITS_PER_SECOND = 64_000;
const WAVE_COLOR = "#27664b";
const WAVE_PROGRESS_COLOR = "#1e523c";

type CapturePhase = "idle" | "recording" | "paused" | "uploading" | "failed";

interface KindController {
  update(node: Node): void;
  dispose(): void;
}

/** create 里登记、update 里取回的控制器；元素就是状态，不另建一棵树。 */
const controllers = new WeakMap<HTMLElement, KindController>();

function registerController(el: HTMLElement, controller: KindController, ctx: RenderContext): void {
  controllers.set(el, controller);
  ctx.cleanup(() => {
    controllers.delete(el);
    controller.dispose();
  });
}

function updateFromNode(el: HTMLElement, node: Node): void {
  controllers.get(el)?.update(node);
}

function prop(node: Node, name: string): string | undefined {
  const value = node.props[name];
  return typeof value === "string" ? value : undefined;
}

function flag(node: Node, name: string): boolean {
  return node.props[name] === true;
}

function numberProp(node: Node, name: string, fallback: number): number {
  const value = node.props[name];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const rest = String(total % 60).padStart(2, "0");
  return minutes + ":" + rest;
}

/** 只在文本真的变了才写，避免每次 tick 都换一次文本节点。 */
function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) {
    el.textContent = text;
  }
}

function setHandler(el: HTMLElement, handler: string | undefined): void {
  if (handler === undefined) {
    delete el.dataset.handler;
  } else {
    el.dataset.handler = handler;
  }
}

function stopTracks(stream: MediaStream | null): void {
  if (stream === null) {
    return;
  }
  stream.getTracks().forEach((track) => {
    track.stop();
  });
}

/**
 * 播放：jsdom / 自动播放被拦时 play() 可能返回 undefined 或 reject，
 * 两种情况都不该让界面炸。
 */
function playQuietly(media: HTMLMediaElement): void {
  try {
    const started: unknown = media.play();
    if (started instanceof Promise) {
      void started.catch(() => undefined);
    }
  } catch (error) {
    console.error("[omora] 播放失败:", error);
  }
}

/** 预览地址：环境没有 createObjectURL（jsdom）时返回 undefined，不崩。 */
function makeObjectUrl(blob: Blob): string | undefined {
  try {
    return URL.createObjectURL(blob);
  } catch (error) {
    console.error("[omora] 生成预览地址失败:", error);
    return undefined;
  }
}

function revokeObjectUrl(url: string | undefined): void {
  if (url === undefined) {
    return;
  }
  try {
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("[omora] 释放预览地址失败:", error);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function micGlyph(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "omora-icon-svg");
  svg.setAttribute("width", "28");
  svg.setAttribute("height", "28");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.dataset.icon = "mic";
  svg.dataset.known = "true";
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", "8");
  rect.setAttribute("y", "2.8");
  rect.setAttribute("width", "4");
  rect.setAttribute("height", "7.4");
  rect.setAttribute("rx", "2");
  const arc = document.createElementNS("http://www.w3.org/2000/svg", "path");
  arc.setAttribute("d", "M5.4 9.2a4.6 4.6 0 0 0 9.2 0");
  const stem = document.createElementNS("http://www.w3.org/2000/svg", "path");
  stem.setAttribute("d", "M10 13.8v2.4M8 16.2h4");
  svg.append(rect, arc, stem);
  return svg;
}

/** 设备下拉：签名没变就不重建 option（保留用户打开状态）。 */
function syncDeviceOptions(
  select: HTMLSelectElement,
  devices: DeviceInfo[],
  kind: DeviceKind,
  selected: string | undefined,
  signature: string,
): string {
  const next =
    devices.map((device) => device.deviceId + "\u0000" + device.label).join("\u0001") +
    "\u0002" +
    (selected ?? "");
  if (next === signature) {
    return signature;
  }
  const options = devices.map((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = deviceLabel(device, index, kind);
    return option;
  });
  select.replaceChildren(...options);
  select.value = selected ?? devices[0]?.deviceId ?? "";
  return next;
}

/* ------------------------------------------------------------------ recorder */

/** recorder：点一下录、再点一下停；录完把 base64 交给 on_submit。 */
class RecorderController implements KindController {
  private node: Node;
  private readonly ctx: RenderContext;
  private readonly listeners = new AbortController();
  private readonly button: HTMLButtonElement;
  private readonly label: Text;
  private readonly hint: HTMLSpanElement;
  private recording = false;
  private seconds = 0;
  private startedAt = 0;
  private timer: number | null = null;
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private disposed = false;

  constructor(el: HTMLElement, node: Node, ctx: RenderContext) {
    this.node = node;
    this.ctx = ctx;
    el.className = "omora-recorder";
    el.dataset.type = "recorder";

    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "omora-record";
    const dot = document.createElement("span");
    dot.className = "omora-record-dot";
    dot.setAttribute("aria-hidden", "true");
    this.label = document.createTextNode("");
    this.button.append(dot, this.label);

    this.hint = document.createElement("span");
    this.hint.className = "omora-record-hint";
    el.append(this.button, this.hint);

    this.button.addEventListener(
      "click",
      () => {
        if (this.recording) {
          this.stop();
        } else {
          void this.start();
        }
      },
      { signal: this.listeners.signal },
    );
    this.render();
  }

  update(node: Node): void {
    this.node = node;
    this.render();
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.abort();
    this.stopTimer();
    const active = this.recorder;
    if (active !== null && active.state !== "inactive") {
      // 卸载时按 v1 行为：停掉这段，不提交（Recorder 不是"录了即存"的捕捉条）。
      active.stop();
      return;
    }
    this.releaseStream();
  }

  private render(): void {
    if (this.disposed) {
      return;
    }
    const handler = handlerOf(this.node, "submit");
    setHandler(this.button, handler);
    this.button.disabled = handler === undefined;
    if (this.recording) {
      this.button.classList.add("is-recording");
      this.label.data = "录音中 " + clock(this.seconds);
      this.hint.textContent = "再点一下停";
      return;
    }
    this.button.classList.remove("is-recording");
    this.label.data = "录音";
    this.hint.textContent = "说出口，比打字快";
  }

  private async start(): Promise<void> {
    const handler = handlerOf(this.node, "submit");
    if (handler === undefined || this.recording || this.disposed) {
      return;
    }
    const Ctor = window.MediaRecorder;
    if (typeof Ctor !== "function") {
      console.error("[omora] 浏览器不支持 MediaRecorder");
      return;
    }
    try {
      const opened = await openMediaStream(defaultDeviceSource(), { audio: true });
      if (this.disposed) {
        stopTracks(opened);
        return;
      }
      this.stream = opened;
      this.chunks = [];
      const media = new Ctor(opened);
      media.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.chunks.push(event.data);
        }
      };
      media.onstop = () => {
        this.settle(media);
      };
      this.recorder = media;
      this.startedAt = Date.now();
      this.seconds = 0;
      this.recording = true;
      this.timer = window.setInterval(() => {
        this.seconds = Math.floor((Date.now() - this.startedAt) / 1000);
        this.render();
      }, 250);
      media.start();
      this.render();
    } catch (error) {
      console.error("[omora] 无法开始录音:", error);
    }
  }

  private settle(media: MediaRecorder): void {
    this.stopTimer();
    this.releaseStream();
    this.recorder = null;
    this.recording = false;
    const elapsed = (Date.now() - this.startedAt) / 1000;
    const blob = new Blob(this.chunks, { type: media.mimeType || "audio/webm" });
    this.chunks = [];
    if (this.disposed) {
      return;
    }
    this.render();
    const handler = handlerOf(this.node, "submit");
    if (blob.size === 0 || handler === undefined) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      const data = comma >= 0 ? result.slice(comma + 1) : "";
      if (this.disposed || data.length === 0) {
        return;
      }
      this.ctx.event(handler, {
        audio: data,
        mime: blob.type || "audio/webm",
        seconds: elapsed,
      });
    };
    reader.readAsDataURL(blob);
  }

  private stop(): void {
    const active = this.recorder;
    if (active !== null && active.state !== "inactive") {
      active.stop();
    }
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private releaseStream(): void {
    stopTracks(this.stream);
    this.stream = null;
  }
}

/* --------------------------------------------------------------------- audio */

/** 全局只留一路音频：点第二条时把上一条停掉（v1 行为）。 */
let currentAudio: HTMLAudioElement | null = null;

/** audio：一条音频；点播放时按需从 media 服务取。 */
class AudioController implements KindController {
  private node: Node;
  private readonly el: HTMLButtonElement;
  private readonly ctx: RenderContext;
  private readonly listeners = new AbortController();
  private audio: HTMLAudioElement | null = null;
  private disposed = false;

  constructor(el: HTMLButtonElement, node: Node, ctx: RenderContext) {
    this.el = el;
    this.node = node;
    this.ctx = ctx;
    this.el.addEventListener(
      "click",
      () => {
        this.play();
      },
      { signal: this.listeners.signal },
    );
    this.render();
  }

  update(node: Node): void {
    this.node = node;
    this.render();
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.abort();
    const playing = this.audio;
    if (playing !== null && currentAudio === playing) {
      playing.pause();
      currentAudio = null;
    }
    this.audio = null;
  }

  private render(): void {
    const media = prop(this.node, "media");
    const ready = media !== undefined && media.length > 0;
    setHandler(this.el, media);
    this.el.disabled = !ready;
  }

  private play(): void {
    const media = prop(this.node, "media");
    if (media === undefined || media.length === 0) {
      return;
    }
    void this.ctx
      .loadMedia(media)
      .then(({ mime, data }) => {
        if (this.disposed) {
          return;
        }
        currentAudio?.pause();
        const next = new window.Audio("data:" + mime + ";base64," + data);
        currentAudio = next;
        this.audio = next;
        playQuietly(next);
      })
      .catch((error: unknown) => {
        console.error("[omora] 取媒体失败:", error);
      });
  }
}

/* -------------------------------------------------------------- audio_capture */

/** audio_capture：大圆钮 + 计时 + 提示 + 波形槽 + 一行动作。 */
class AudioCaptureController implements KindController {
  private node: Node;
  private readonly ctx: RenderContext;
  private readonly el: HTMLDivElement;
  private readonly listeners = new AbortController();
  private readonly tracker: DeviceTracker;
  private readonly talk: HTMLButtonElement;
  private readonly micIcon: SVGSVGElement;
  private readonly stopIcon: HTMLSpanElement;
  private readonly clockEl: HTMLSpanElement;
  private readonly hint: HTMLSpanElement;
  private readonly pauseButton: HTMLButtonElement;
  private readonly resumeButton: HTMLButtonElement;
  private readonly retryButton: HTMLButtonElement;
  private readonly deviceSelect: HTMLSelectElement;
  private readonly wave: HTMLDivElement;
  private deviceState: DeviceState;
  private deviceSignature = "";
  private phase: CapturePhase = "idle";
  private seconds = 0;
  private clock: RecordClock = startClock(Date.now());
  private error: string | undefined;
  private selectedDeviceId: string | undefined;
  private ticker: number | null = null;
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private pending: { blob: Blob; seconds: number } | null = null;
  private submitted = false;
  private starting = false;
  private autostarted = false;
  private disposed = false;

  constructor(el: HTMLDivElement, node: Node, ctx: RenderContext) {
    this.el = el;
    this.node = node;
    this.ctx = ctx;
    el.className = "omora-record-bar";
    el.dataset.type = "audio_capture";

    this.talk = document.createElement("button");
    this.talk.type = "button";
    this.talk.className = "omora-talk";
    this.micIcon = micGlyph();
    this.stopIcon = document.createElement("span");
    this.stopIcon.className = "omora-talk-stop";
    this.clockEl = document.createElement("span");
    this.clockEl.className = "omora-record-clock";
    this.hint = document.createElement("span");
    this.hint.className = "omora-record-hint";
    this.pauseButton = actionButton("暂停");
    this.resumeButton = actionButton("继续");
    this.retryButton = actionButton("重试");
    this.deviceSelect = document.createElement("select");
    this.deviceSelect.className = "omora-device";
    this.deviceSelect.dataset.type = "device_select";
    this.deviceSelect.setAttribute("aria-label", "选择麦克风");
    const actions = document.createElement("div");
    actions.className = "omora-record-actions";
    actions.append(this.pauseButton, this.resumeButton, this.retryButton, this.deviceSelect);
    this.wave = document.createElement("div");
    this.wave.className = "omora-wave";
    el.append(this.talk, this.clockEl, this.hint, actions, this.wave);

    this.tracker = createDeviceTracker(defaultDeviceSource(), (state) => {
      if (this.disposed) {
        return;
      }
      this.deviceState = state;
      this.render();
      this.maybeAutostart();
    });
    this.deviceState = this.tracker.state;

    this.talk.addEventListener(
      "click",
      () => {
        void this.tracker.refresh();
        if (this.phase === "idle") {
          void this.start();
        } else {
          this.stop();
        }
      },
      { signal: this.listeners.signal },
    );
    this.pauseButton.addEventListener("click", () => this.pause(), {
      signal: this.listeners.signal,
    });
    this.resumeButton.addEventListener("click", () => this.resume(), {
      signal: this.listeners.signal,
    });
    this.retryButton.addEventListener("click", () => this.retry(), {
      signal: this.listeners.signal,
    });
    this.deviceSelect.addEventListener(
      "change",
      () => {
        this.selectedDeviceId = this.deviceSelect.value;
        this.render();
      },
      { signal: this.listeners.signal },
    );

    void this.tracker.refresh();
    this.render();
  }

  update(node: Node): void {
    this.node = node;
    if (this.disposed) {
      return;
    }
    this.render();
    this.maybeAutostart();
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.abort();
    this.stopTicker();
    this.tracker.stop();
    const active = this.recorder;
    if (active !== null && active.state !== "inactive") {
      // 还在录：停下来，等 onstop 按"录了即存"提交（这是 v1 的卸载行为）。
      active.stop();
      return;
    }
    this.releaseStream();
  }

  private handler(): string | undefined {
    return handlerOf(this.node, "submit");
  }

  private uploadUrl(): string | undefined {
    return prop(this.node, "upload_url");
  }

  private gate(): ReturnType<typeof captureGate> {
    return captureGate(this.deviceState, "audioinput");
  }

  private ready(): boolean {
    return this.gate().enabled && this.uploadUrl() !== undefined && this.handler() !== undefined;
  }

  private active(): boolean {
    return this.phase === "recording" || this.phase === "paused";
  }

  private hintText(): string {
    const gate = this.gate();
    if (!this.ready()) {
      return gate.enabled ? "媒体通道未就绪" : (gate.reason ?? "");
    }
    if (this.error !== undefined) {
      return this.error;
    }
    if (this.phase === "recording") {
      return "点一下停";
    }
    if (this.phase === "paused") {
      return "已暂停，可以继续或直接停";
    }
    if (this.phase === "uploading") {
      return "上传中…";
    }
    return "点一下开始，按住空格说";
  }

  private render(): void {
    if (this.disposed) {
      return;
    }
    const gate = this.gate();
    const handler = this.handler();
    const ready = this.ready();
    const active = this.active();
    this.el.dataset.gate = ready ? "on" : "off";
    this.el.dataset.phase = this.phase;

    setHandler(this.talk, handler);
    this.talk.dataset.phase = this.phase;
    this.talk.disabled = !ready || this.phase === "uploading" || this.phase === "failed";
    this.talk.setAttribute("aria-label", this.phase === "idle" ? "开始录音" : "停止录音");
    if (this.phase === "idle") {
      if (this.talk.firstChild !== this.micIcon) {
        this.talk.replaceChildren(this.micIcon);
      }
    } else if (this.talk.firstChild !== this.stopIcon) {
      this.talk.replaceChildren(this.stopIcon);
    }

    this.clockEl.hidden = !active;
    if (active) {
      this.clockEl.textContent = clock(this.seconds);
      if (this.phase === "paused") {
        const small = document.createElement("small");
        small.textContent = "已暂停";
        this.clockEl.append(small);
      }
    }

    this.hint.textContent = this.hintText();

    const pausable = flag(this.node, "pausable");
    this.pauseButton.hidden = !(pausable && this.phase === "recording");
    this.resumeButton.hidden = !(pausable && this.phase === "paused");
    this.retryButton.hidden = this.phase !== "failed";

    const showDevice = ready && gate.devices.length > 1 && !active;
    this.deviceSelect.hidden = !showDevice;
    this.deviceSelect.disabled = this.phase !== "idle";
    if (showDevice) {
      this.deviceSignature = syncDeviceOptions(
        this.deviceSelect,
        gate.devices,
        "audioinput",
        this.selectedDeviceId,
        this.deviceSignature,
      );
    }

    this.wave.dataset.live = active ? "on" : "off";
  }

  private maybeAutostart(): void {
    if (this.disposed || this.autostarted) {
      return;
    }
    if (!flag(this.node, "autostart") || !this.ready()) {
      return;
    }
    this.autostarted = true;
    void this.start();
  }

  private async start(): Promise<void> {
    if (this.starting || this.phase !== "idle" || !this.ready() || this.disposed) {
      return;
    }
    const Ctor = window.MediaRecorder;
    if (typeof Ctor !== "function") {
      console.error("[omora] 浏览器不支持 MediaRecorder");
      return;
    }
    this.starting = true;
    this.error = undefined;
    this.submitted = false;
    this.pending = null;
    try {
      const constraints: MediaStreamConstraints =
        this.selectedDeviceId === undefined
          ? { audio: true }
          : { audio: { deviceId: { ideal: this.selectedDeviceId } } };
      const opened = await openMediaStream(defaultDeviceSource(), constraints);
      if (this.disposed || this.phase !== "idle") {
        stopTracks(opened);
        return;
      }
      this.stream = opened;
      this.chunks = [];
      const options: MediaRecorderOptions = {
        mimeType: "audio/webm",
        audioBitsPerSecond:
          this.quality() === "low" ? AUDIO_LOW_BITS_PER_SECOND : AUDIO_BITS_PER_SECOND,
      };
      const media = new Ctor(opened, options);
      media.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.chunks.push(event.data);
        }
      };
      media.onstop = () => {
        this.settle(media);
      };
      this.recorder = media;
      this.clock = startClock(Date.now());
      this.seconds = 0;
      this.phase = "recording";
      media.start();
      this.startTicker();
      this.render();
      void this.tracker.refresh();
    } catch (error) {
      this.releaseStream();
      if (!this.disposed) {
        this.error = captureErrorReason(error, "audioinput");
        this.phase = "idle";
        this.render();
      }
    } finally {
      this.starting = false;
    }
  }

  private quality(): string {
    return prop(this.node, "quality") ?? "high";
  }

  private settle(media: MediaRecorder): void {
    this.stopTicker();
    this.releaseStream();
    this.recorder = null;
    const ended = clockSeconds(this.clock, Date.now());
    const blob = new Blob(this.chunks, { type: media.mimeType || "audio/webm" });
    this.chunks = [];
    const plan = planStop({
      submitted: this.submitted,
      hasData: blob.size > 0,
      hasHandler: this.handler() !== undefined,
      unmounted: this.disposed,
    });
    if (plan.updateUi) {
      this.phase = "idle";
      this.render();
    }
    if (plan.submit) {
      void this.upload(blob, ended);
    }
  }

  private async upload(blob: Blob, seconds: number): Promise<void> {
    if (!this.disposed) {
      this.phase = "uploading";
      this.error = undefined;
      this.render();
    }
    const attempt = await uploadRecorded(this.uploadUrl(), blob, this.disposed);
    const handler = this.handler();
    if (attempt.plan.submit && attempt.mediaId !== undefined && handler !== undefined) {
      this.submitted = true;
      this.ctx.event(handler, {
        media: attempt.mediaId,
        mime: blob.type || "audio/webm",
        seconds,
      });
    }
    if (attempt.plan.log) {
      console.error("[omora] 录音没存上，节点已卸载:", attempt.plan.reason);
    }
    this.pending = attempt.plan.keepBlob ? { blob, seconds } : null;
    if (!attempt.plan.updateUi) {
      return;
    }
    this.error = attempt.plan.reason.length > 0 ? attempt.plan.reason : undefined;
    this.phase = attempt.plan.phase;
    this.render();
  }

  private stop(): void {
    const active = this.recorder;
    if (active !== null && active.state !== "inactive") {
      active.stop();
    }
  }

  private pause(): void {
    const active = this.recorder;
    if (active === null || active.state !== "recording" || !flag(this.node, "pausable")) {
      return;
    }
    try {
      active.pause();
    } catch (error) {
      console.error("[omora] 暂停失败:", error);
      return;
    }
    this.clock = pauseClock(this.clock, Date.now());
    this.phase = "paused";
    this.render();
  }

  private resume(): void {
    const active = this.recorder;
    if (active === null || active.state !== "paused" || !flag(this.node, "pausable")) {
      return;
    }
    try {
      active.resume();
    } catch (error) {
      console.error("[omora] 继续失败:", error);
      return;
    }
    this.clock = resumeClock(this.clock, Date.now());
    this.phase = "recording";
    this.render();
  }

  private retry(): void {
    const last = this.pending;
    if (last !== null) {
      void this.upload(last.blob, last.seconds);
    }
  }

  private startTicker(): void {
    this.stopTicker();
    this.ticker = window.setInterval(() => {
      this.seconds = clockSeconds(this.clock, Date.now());
      this.render();
      if (timeUp(numberProp(this.node, "max_seconds", AUDIO_MAX_SECONDS), this.seconds)) {
        this.stop();
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
}

/* -------------------------------------------------------------- video_capture */

/** video_capture：摄像头只在点的时候打开；录完上传，失败留着等重试。 */
class VideoCaptureController implements KindController {
  private node: Node;
  private readonly ctx: RenderContext;
  private readonly el: HTMLDivElement;
  private readonly listeners = new AbortController();
  private readonly tracker: DeviceTracker;
  private readonly liveVideo: HTMLVideoElement;
  private readonly previewVideo: HTMLVideoElement;
  private readonly startButton: HTMLButtonElement;
  private readonly stopLabel: Text;
  private readonly stopButton: HTMLButtonElement;
  private readonly pauseButton: HTMLButtonElement;
  private readonly resumeButton: HTMLButtonElement;
  private readonly retryButton: HTMLButtonElement;
  private readonly deviceSelect: HTMLSelectElement;
  private readonly hint: HTMLSpanElement;
  private deviceState: DeviceState;
  private deviceSignature = "";
  private phase: CapturePhase = "idle";
  private seconds = 0;
  private clock: RecordClock = startClock(Date.now());
  private error: string | undefined;
  private selectedDeviceId: string | undefined;
  private ticker: number | null = null;
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private liveStream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private recordedSeconds = 0;
  private pending: Blob | null = null;
  private previewUrl: string | undefined;
  private submitted = false;
  private starting = false;
  private disposed = false;

  constructor(el: HTMLDivElement, node: Node, ctx: RenderContext) {
    this.el = el;
    this.node = node;
    this.ctx = ctx;
    el.className = "omora-video-bar";
    el.dataset.type = "video_capture";

    this.liveVideo = document.createElement("video");
    this.liveVideo.className = "omora-video";
    this.liveVideo.dataset.type = "video-live";
    this.liveVideo.autoplay = true;
    this.liveVideo.muted = true;
    this.liveVideo.playsInline = true;
    this.liveVideo.hidden = true;
    this.previewVideo = document.createElement("video");
    this.previewVideo.className = "omora-video";
    this.previewVideo.controls = true;
    this.previewVideo.playsInline = true;
    this.previewVideo.hidden = true;

    this.startButton = document.createElement("button");
    this.startButton.type = "button";
    this.startButton.className = "omora-record";
    const dot = document.createElement("span");
    dot.className = "omora-record-dot";
    dot.setAttribute("aria-hidden", "true");
    this.startButton.append(dot, document.createTextNode("录视频"));
    this.stopLabel = document.createTextNode("");
    this.stopButton = document.createElement("button");
    this.stopButton.type = "button";
    this.stopButton.className = "omora-record is-recording";
    this.stopButton.append(this.stopLabel);
    this.pauseButton = actionButton("暂停", "omora-record omora-record--quiet");
    this.resumeButton = actionButton("继续", "omora-record omora-record--quiet");
    this.retryButton = actionButton("重试", "omora-record");
    this.deviceSelect = document.createElement("select");
    this.deviceSelect.className = "omora-device";
    this.deviceSelect.dataset.type = "device_select";
    this.deviceSelect.setAttribute("aria-label", "选择摄像头");
    const actions = document.createElement("div");
    actions.className = "omora-video-actions";
    actions.append(
      this.startButton,
      this.stopButton,
      this.pauseButton,
      this.resumeButton,
      this.retryButton,
      this.deviceSelect,
    );
    this.hint = document.createElement("span");
    this.hint.className = "omora-record-hint";
    actions.append(this.hint);
    el.append(this.liveVideo, this.previewVideo, actions);

    this.tracker = createDeviceTracker(defaultDeviceSource(), (state) => {
      if (this.disposed) {
        return;
      }
      this.deviceState = state;
      this.render();
    });
    this.deviceState = this.tracker.state;

    this.startButton.addEventListener("click", () => void this.start(), {
      signal: this.listeners.signal,
    });
    this.stopButton.addEventListener("click", () => this.stop(), {
      signal: this.listeners.signal,
    });
    this.pauseButton.addEventListener("click", () => this.pause(), {
      signal: this.listeners.signal,
    });
    this.resumeButton.addEventListener("click", () => this.resume(), {
      signal: this.listeners.signal,
    });
    this.retryButton.addEventListener("click", () => this.retry(), {
      signal: this.listeners.signal,
    });
    this.deviceSelect.addEventListener(
      "change",
      () => {
        this.selectedDeviceId = this.deviceSelect.value;
        this.render();
      },
      { signal: this.listeners.signal },
    );

    void this.tracker.refresh();
    this.render();
  }

  update(node: Node): void {
    this.node = node;
    this.render();
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.abort();
    this.tracker.stop();
    this.stopTicker();
    revokeObjectUrl(this.previewUrl);
    this.previewUrl = undefined;
    const active = this.recorder;
    if (active !== null && active.state !== "inactive") {
      active.stop();
      return;
    }
    this.release();
    this.liveVideo.srcObject = null;
    this.liveStream = null;
  }

  private handler(): string | undefined {
    return handlerOf(this.node, "submit");
  }

  private uploadUrl(): string | undefined {
    return prop(this.node, "upload_url");
  }

  private gate(): ReturnType<typeof captureGate> {
    return captureGate(this.deviceState, "videoinput");
  }

  private ready(): boolean {
    return this.gate().enabled && this.uploadUrl() !== undefined && this.handler() !== undefined;
  }

  private pausable(): boolean {
    return flag(this.node, "pausable");
  }

  private quality(): string {
    return prop(this.node, "quality") ?? "720p";
  }

  private active(): boolean {
    return this.phase === "recording" || this.phase === "paused";
  }

  private hintText(): string {
    const gate = this.gate();
    if (!this.ready()) {
      return gate.enabled ? "媒体通道未就绪" : (gate.reason ?? "");
    }
    if (this.error !== undefined) {
      return this.error;
    }
    if (this.phase === "uploading") {
      return "上传中…";
    }
    if (this.phase === "paused") {
      return "已暂停";
    }
    return "摄像头只在你点的时候打开";
  }

  private render(): void {
    if (this.disposed) {
      return;
    }
    const gate = this.gate();
    const handler = this.handler();
    const ready = this.ready();
    const active = this.active();
    this.el.dataset.gate = ready ? "on" : "off";
    this.el.dataset.mode = this.phase;

    if (active) {
      if (this.liveStream !== this.stream) {
        this.liveVideo.srcObject = this.stream;
        this.liveStream = this.stream;
        playQuietly(this.liveVideo);
      }
    } else if (this.liveStream !== null) {
      this.liveVideo.srcObject = null;
      this.liveStream = null;
    }
    this.liveVideo.hidden = !active;

    const preview = this.previewUrl !== undefined && !active;
    this.previewVideo.hidden = !preview;
    if (preview && this.previewUrl !== undefined) {
      if (this.previewVideo.getAttribute("src") !== this.previewUrl) {
        this.previewVideo.setAttribute("src", this.previewUrl);
      }
    } else {
      this.previewVideo.removeAttribute("src");
    }

    setHandler(this.startButton, handler);
    this.startButton.disabled = !ready;
    this.startButton.hidden = this.phase !== "idle";
    this.stopButton.hidden = !active;
    this.stopLabel.data = clock(this.seconds) + " 停止";
    this.pauseButton.hidden = !(this.pausable() && this.phase === "recording");
    this.resumeButton.hidden = !(this.pausable() && this.phase === "paused");
    this.retryButton.hidden = this.phase !== "failed";

    const showDevice = ready && this.phase === "idle" && gate.devices.length > 1;
    this.deviceSelect.hidden = !showDevice;
    if (showDevice) {
      this.deviceSignature = syncDeviceOptions(
        this.deviceSelect,
        gate.devices,
        "videoinput",
        this.selectedDeviceId,
        this.deviceSignature,
      );
    }

    this.hint.textContent = this.hintText();
  }

  private async start(): Promise<void> {
    if (this.starting || this.phase !== "idle" || !this.ready() || this.disposed) {
      return;
    }
    const Ctor = window.MediaRecorder;
    if (typeof Ctor !== "function") {
      console.error("[omora] 浏览器不支持 MediaRecorder");
      return;
    }
    this.starting = true;
    this.error = undefined;
    this.submitted = false;
    this.recordedSeconds = 0;
    this.pending = null;
    this.showPreview(null);
    try {
      const opened = await openMediaStream(defaultDeviceSource(), {
        video: videoConstraints(this.quality(), this.selectedDeviceId),
        audio: false,
      });
      if (this.disposed || this.phase !== "idle") {
        stopTracks(opened);
        return;
      }
      this.stream = opened;
      // 先让 ISP 收敛，别把开头那次亮度跳变录进去（v1 的预热）。
      await delay(WARMUP_MS);
      if (this.disposed || this.phase !== "idle") {
        this.release();
        return;
      }
      const media = new Ctor(opened, {
        videoBitsPerSecond: videoBitrate(this.quality()),
      });
      this.chunks = [];
      media.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.chunks.push(event.data);
        }
      };
      media.onstop = () => {
        this.settle(media);
      };
      this.recorder = media;
      this.clock = startClock(Date.now());
      this.seconds = 0;
      this.phase = "recording";
      media.start();
      this.startTicker();
      this.render();
      void this.tracker.refresh();
    } catch (error) {
      this.release();
      if (!this.disposed) {
        this.error = captureErrorReason(error, "videoinput");
        this.phase = "idle";
        this.render();
      }
    } finally {
      this.starting = false;
    }
  }

  private settle(media: MediaRecorder): void {
    this.stopTicker();
    this.release();
    this.recorder = null;
    this.recordedSeconds = clockSeconds(this.clock, Date.now());
    const blob = new Blob(this.chunks, { type: media.mimeType || "video/webm" });
    this.chunks = [];
    const plan = planStop({
      submitted: this.submitted,
      hasData: blob.size > 0,
      hasHandler: this.handler() !== undefined,
      unmounted: this.disposed,
    });
    if (plan.updateUi) {
      if (blob.size === 0) {
        this.error = "没有录到画面";
        this.phase = "idle";
      } else {
        this.pending = blob;
        this.showPreview(blob);
        this.phase = "uploading";
      }
      this.render();
    }
    if (plan.submit) {
      void this.upload(blob);
    }
  }

  private async upload(blob: Blob): Promise<void> {
    if (!this.disposed) {
      this.error = undefined;
      this.phase = "uploading";
      this.render();
    }
    const attempt = await uploadRecorded(this.uploadUrl(), blob, this.disposed);
    const handler = this.handler();
    if (attempt.plan.submit && attempt.mediaId !== undefined && handler !== undefined) {
      this.submitted = true;
      this.ctx.event(handler, {
        media: attempt.mediaId,
        mime: blob.type || "video/webm",
        seconds: this.recordedSeconds,
      });
    }
    if (attempt.plan.log) {
      console.error("[omora] 视频没存上，节点已卸载:", attempt.plan.reason);
    }
    if (!attempt.plan.updateUi) {
      return;
    }
    this.error = attempt.plan.reason.length > 0 ? attempt.plan.reason : undefined;
    this.phase = attempt.plan.phase;
    if (attempt.plan.keepBlob) {
      this.pending = blob;
    } else {
      this.pending = null;
      this.showPreview(null);
    }
    this.render();
  }

  private showPreview(blob: Blob | null): void {
    revokeObjectUrl(this.previewUrl);
    this.previewUrl = undefined;
    if (blob !== null) {
      this.previewUrl = makeObjectUrl(blob);
    }
    this.render();
  }

  private stop(): void {
    const active = this.recorder;
    if (active !== null && active.state !== "inactive") {
      active.stop();
    }
  }

  private pause(): void {
    const active = this.recorder;
    if (active === null || active.state !== "recording" || !this.pausable()) {
      return;
    }
    try {
      active.pause();
    } catch (error) {
      console.error("[omora] 暂停失败:", error);
      return;
    }
    this.clock = pauseClock(this.clock, Date.now());
    this.phase = "paused";
    this.render();
  }

  private resume(): void {
    const active = this.recorder;
    if (active === null || active.state !== "paused" || !this.pausable()) {
      return;
    }
    try {
      active.resume();
    } catch (error) {
      console.error("[omora] 继续失败:", error);
      return;
    }
    this.clock = resumeClock(this.clock, Date.now());
    this.phase = "recording";
    this.render();
  }

  private retry(): void {
    if (this.pending !== null) {
      void this.upload(this.pending);
    }
  }

  private startTicker(): void {
    this.stopTicker();
    this.ticker = window.setInterval(() => {
      this.seconds = clockSeconds(this.clock, Date.now());
      this.render();
      if (timeUp(numberProp(this.node, "max_seconds", VIDEO_DEFAULT_SECONDS), this.seconds)) {
        this.stop();
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
    stopTracks(this.stream);
    this.stream = null;
    this.stopTicker();
  }
}

/* ---------------------------------------------------------------------- video */

interface VideoState {
  node: Node;
  child: HTMLSpanElement | HTMLVideoElement | null;
}

const videoStates = new WeakMap<HTMLElement, VideoState>();

function replaceVideoChild(
  wrapper: HTMLSpanElement,
  state: VideoState,
  next: HTMLSpanElement | HTMLVideoElement,
): void {
  const previous = state.child;
  if (previous === null) {
    wrapper.append(next);
  } else {
    wrapper.replaceChild(next, previous);
  }
  state.child = next;
}

/** video：一条视频；src 就是 HTTP 媒体通道的播放地址。 */
function renderVideo(wrapper: HTMLSpanElement, state: VideoState): void {
  const src = prop(state.node, "src") ?? "";
  const media = prop(state.node, "media") ?? "";
  if (src.length > 0) {
    const current = state.child;
    const video = current instanceof HTMLVideoElement ? current : document.createElement("video");
    if (!(current instanceof HTMLVideoElement)) {
      video.className = "omora-video";
      video.dataset.type = "video";
      video.controls = true;
      video.preload = "metadata";
      video.playsInline = true;
      replaceVideoChild(wrapper, state, video);
    }
    video.dataset.media = media;
    if (video.getAttribute("src") !== src) {
      video.setAttribute("src", src);
    }
    state.child = video;
    return;
  }
  const current = state.child;
  const missing = current instanceof HTMLSpanElement ? current : document.createElement("span");
  if (!(current instanceof HTMLSpanElement)) {
    missing.className = "omora-video-missing";
    missing.dataset.type = "video";
    replaceVideoChild(wrapper, state, missing);
  }
  missing.dataset.media = media;
  setText(missing, "媒体通道未就绪");
  state.child = missing;
}

/* -------------------------------------------------------------------- waveform */

interface WaveformState {
  node: Node;
  src: string | null;
  wave: { destroy(): void } | null;
  generation: number;
  disposed: boolean;
}

const waveforms = new WeakMap<HTMLElement, WaveformState>();

let waveSurferLoading: Promise<typeof WaveSurfer> | null = null;

/** 静态引入会让 node 环境的测试直接炸；用到时再拉，只拉一次。 */
function loadWaveSurfer(): Promise<typeof WaveSurfer> {
  if (waveSurferLoading === null) {
    waveSurferLoading = import("wavesurfer.js").then((module) => module.default);
  }
  return waveSurferLoading;
}

function destroyWave(state: WaveformState): void {
  const wave = state.wave;
  state.wave = null;
  if (wave !== null) {
    try {
      wave.destroy();
    } catch (error) {
      console.error("[omora] 波形销毁失败:", error);
    }
  }
}

/** src 变了才重画：其余更新（比如只改子节点）不重建 wavesurfer。 */
function applyWaveform(el: HTMLElement, state: WaveformState): void {
  const src = prop(state.node, "src") ?? "";
  el.dataset.src = src;
  if (state.src === src) {
    return;
  }
  state.src = src;
  state.generation += 1;
  const generation = state.generation;
  destroyWave(state);
  if (src.length === 0) {
    return;
  }
  void loadWaveSurfer()
    .then((WaveSurfer) => {
      if (state.disposed || generation !== state.generation) {
        return;
      }
      state.wave = WaveSurfer.create({
        container: el,
        url: src,
        height: 32,
        waveColor: WAVE_COLOR,
        progressColor: WAVE_PROGRESS_COLOR,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        cursorWidth: 0,
        interact: false,
        normalize: true,
      });
    })
    .catch((error: unknown) => {
      console.error("[omora] 波形加载失败:", error);
    });
}

/* ----------------------------------------------------------------------- kinds */

function actionButton(text: string, className = "omora-button"): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.hidden = true;
  return button;
}

/** 媒体组：全部保留 v1 的 class / data-type / data-handler 标记。 */
export const mediaKinds: KindRegistry = {
  recorder: {
    create(node, ctx) {
      const el = document.createElement("div");
      const controller = new RecorderController(el, node, ctx);
      registerController(el, controller, ctx);
      return el;
    },
    update(el, node) {
      updateFromNode(el, node);
    },
  },
  audio: {
    create(node, ctx) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "omora-audio";
      el.dataset.type = "audio";
      el.setAttribute("aria-label", "播放");
      el.textContent = "▶";
      const controller = new AudioController(el, node, ctx);
      registerController(el, controller, ctx);
      return el;
    },
    update(el, node) {
      updateFromNode(el, node);
    },
  },
  audio_capture: {
    create(node, ctx) {
      const el = document.createElement("div");
      const controller = new AudioCaptureController(el, node, ctx);
      registerController(el, controller, ctx);
      return el;
    },
    update(el, node) {
      updateFromNode(el, node);
    },
  },
  video_capture: {
    create(node, ctx) {
      const el = document.createElement("div");
      const controller = new VideoCaptureController(el, node, ctx);
      registerController(el, controller, ctx);
      return el;
    },
    update(el, node) {
      updateFromNode(el, node);
    },
  },
  video: {
    create(node) {
      const wrapper = document.createElement("span");
      // display: contents：不生成新的盒，换 video / missing 时布局与 v1 一致。
      wrapper.style.display = "contents";
      const state: VideoState = { node, child: null };
      renderVideo(wrapper, state);
      videoStates.set(wrapper, state);
      return wrapper;
    },
    update(el, node) {
      const state = videoStates.get(el);
      if (state === undefined) {
        return;
      }
      state.node = node;
      renderVideo(el, state);
    },
  },
  waveform: {
    create(node, ctx) {
      const el = document.createElement("div");
      el.className = "omora-waveform";
      el.dataset.type = "waveform";
      const state: WaveformState = {
        node,
        src: null,
        wave: null,
        generation: 0,
        disposed: false,
      };
      waveforms.set(el, state);
      applyWaveform(el, state);
      ctx.cleanup(() => {
        state.disposed = true;
        state.generation += 1;
        destroyWave(state);
        waveforms.delete(el);
      });
      return el;
    },
    update(el, node) {
      const state = waveforms.get(el);
      if (state === undefined) {
        return;
      }
      state.node = node;
      applyWaveform(el, state);
    },
  },
};
