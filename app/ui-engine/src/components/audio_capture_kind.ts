import { planStop, timeUp } from "../capture/capture-rules";
import { captureErrorReason } from "../capture/devices";
import { uploadRecorded } from "../capture/media-upload";
import type { Node } from "../core/types";
import { handlerOf } from "../renderer/events";
import { iconGlyph } from "./icons";
import type { RenderContext } from "../renderer/types";
import { createAudioCaptureEngine, type AudioCaptureEngine } from "./audio_capture_engine";
import {
  actionButton,
  clock,
  DeviceWatch,
  flag,
  numberProp,
  prop,
  setHandler,
  syncDeviceOptions,
  type CapturePhase,
} from "./media_shared";

/**
 * audio_capture：大圆钮 + 计时 + 提示 + 实时波形 + 一行动作。
 *
 * 版式与 legacy 实现一致；录音机制在 audio_capture_engine（wavesurfer record 插件，
 * 失败时降级 MediaRecorder）。这里只管设备门禁、界面、上传与卸载即提交。
 */

const AUDIO_MAX_SECONDS = 600;
const AUDIO_BITS_PER_SECOND = 128_000;
const AUDIO_LOW_BITS_PER_SECOND = 64_000;

export class AudioCaptureController {
  private node: Node;
  private readonly ctx: RenderContext;
  private readonly el: HTMLDivElement;
  private readonly listeners = new AbortController();
  private readonly devices: DeviceWatch;
  private readonly engine: AudioCaptureEngine;
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
  private deviceSignature = "";
  private phase: CapturePhase = "idle";
  private seconds = 0;
  private error: string | undefined;
  private selectedDeviceId: string | undefined;
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
    this.micIcon = iconGlyph("mic", undefined, 28);
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

    this.engine = createAudioCaptureEngine(this.wave, this.bitsPerSecond(), {
      onProgress: (seconds) => this.onProgress(seconds),
      onPhase: (phase) => {
        this.phase = phase;
        this.render();
      },
      onEnd: (blob, seconds) => this.settle(blob, seconds),
      onReady: () => this.maybeAutostart(),
    });
    this.devices = new DeviceWatch(() => {
      if (this.disposed) {
        return;
      }
      this.render();
      this.maybeAutostart();
    });

    this.talk.addEventListener(
      "click",
      () => {
        this.devices.refresh();
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

    this.devices.watch();
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
    this.devices.dispose();
    // 引擎自己处理"还在录就先停、录完再销毁"；onEnd 之后按录了即存提交。
    this.engine.dispose();
  }

  private bitsPerSecond(): number {
    return prop(this.node, "quality") === "low" ? AUDIO_LOW_BITS_PER_SECOND : AUDIO_BITS_PER_SECOND;
  }

  private handler(): string | undefined {
    return handlerOf(this.node, "submit");
  }

  private gate(): ReturnType<DeviceWatch["gate"]> {
    return this.devices.gate("audioinput");
  }

  private ready(): boolean {
    return (
      this.gate().enabled &&
      prop(this.node, "upload_url") !== undefined &&
      this.handler() !== undefined
    );
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

  private onProgress(seconds: number): void {
    this.seconds = seconds;
    this.render();
    if (timeUp(numberProp(this.node, "max_seconds", AUDIO_MAX_SECONDS), seconds)) {
      this.stop();
    }
  }

  private async start(): Promise<void> {
    if (this.starting || this.phase !== "idle" || !this.ready() || this.disposed) {
      return;
    }
    this.starting = true;
    this.error = undefined;
    this.submitted = false;
    this.pending = null;
    try {
      await this.engine.start(this.selectedDeviceId);
    } catch (error) {
      if (!this.disposed) {
        this.error = captureErrorReason(error, "audioinput");
        this.phase = "idle";
        this.render();
      }
    } finally {
      this.starting = false;
    }
  }

  private settle(blob: Blob, seconds: number): void {
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
      void this.upload(blob, seconds);
    }
  }

  private async upload(blob: Blob, seconds: number): Promise<void> {
    if (!this.disposed) {
      this.phase = "uploading";
      this.error = undefined;
      this.render();
    }
    const attempt = await uploadRecorded(prop(this.node, "upload_url"), blob, this.disposed);
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
    if (this.engine.isActive()) {
      this.engine.stop();
    }
  }

  private pause(): void {
    if (this.phase !== "recording" || !flag(this.node, "pausable")) {
      return;
    }
    this.engine.pause();
  }

  private resume(): void {
    if (this.phase !== "paused" || !flag(this.node, "pausable")) {
      return;
    }
    this.engine.resume();
  }

  private retry(): void {
    const last = this.pending;
    if (last !== null) {
      void this.upload(last.blob, last.seconds);
    }
  }
}
