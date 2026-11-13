import { planStop, timeUp } from "../capture/capture-rules";
import { captureErrorReason } from "../capture/devices";
import { uploadRecorded } from "../capture/media-upload";
import { DEFAULT_SECONDS } from "../capture/video/video-quality";
import type { Node } from "../core/types";
import { handlerOf } from "../dom/events";
import type { RenderContext } from "../dom/types";
import {
  actionButton,
  clock,
  DeviceWatch,
  flag,
  numberProp,
  playQuietly,
  prop,
  setHandler,
  syncDeviceOptions,
  type CapturePhase,
} from "./media_shared";
import { createVideoRecorder, type VideoRecorder } from "./video_recorder";

/**
 * video_capture：摄像头只在点的时候打开；录完先出本地回放，再上传媒体通道。
 *
 * 录制机制在 video_recorder；这里管设备门禁、实时预览 / 回放、上传与重试、
 * 卸载即提交。markup 与 legacy 一致。
 */

export class VideoCaptureController {
  private node: Node;
  private readonly ctx: RenderContext;
  private readonly el: HTMLDivElement;
  private readonly listeners = new AbortController();
  private readonly devices: DeviceWatch;
  private readonly engine: VideoRecorder;
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
  private deviceSignature = "";
  private phase: CapturePhase = "idle";
  private seconds = 0;
  private error: string | undefined;
  private selectedDeviceId: string | undefined;
  private pending: Blob | null = null;
  private liveStream: MediaStream | null = null;
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

    this.engine = createVideoRecorder({
      onStart: () => {
        this.phase = "recording";
        this.seconds = 0;
        this.render();
        this.devices.refresh();
      },
      onPause: () => {
        this.phase = "paused";
        this.render();
      },
      onResume: () => {
        this.phase = "recording";
        this.render();
      },
      onTick: (seconds) => {
        this.seconds = seconds;
        this.render();
        if (timeUp(numberProp(this.node, "max_seconds", DEFAULT_SECONDS), seconds)) {
          this.stop();
        }
      },
      onEnd: (blob, seconds) => this.settle(blob, seconds),
    });
    this.devices = new DeviceWatch(() => {
      if (!this.disposed) {
        this.render();
      }
    });

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

    this.devices.watch();
    this.render();
  }

  update(node: Node): void {
    this.node = node;
    if (!this.disposed) {
      this.render();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.abort();
    this.devices.dispose();
    this.engine.dispose();
  }

  private handler(): string | undefined {
    return handlerOf(this.node, "submit");
  }

  private gate(): ReturnType<DeviceWatch["gate"]> {
    return this.devices.gate("videoinput");
  }

  private ready(): boolean {
    return (
      this.gate().enabled &&
      prop(this.node, "upload_url") !== undefined &&
      this.handler() !== undefined
    );
  }

  private pausable(): boolean {
    return flag(this.node, "pausable");
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
      const stream = this.engine.stream();
      if (this.liveStream !== stream) {
        this.liveVideo.srcObject = stream;
        this.liveStream = stream;
        playQuietly(this.liveVideo);
      }
    } else if (this.liveStream !== null) {
      this.liveVideo.srcObject = null;
      this.liveStream = null;
    }
    this.liveVideo.hidden = !active;

    const preview = this.engine.previewUrl();
    const showPreview = preview !== undefined && !active;
    this.previewVideo.hidden = !showPreview;
    if (preview !== undefined && showPreview) {
      if (this.previewVideo.getAttribute("src") !== preview) {
        this.previewVideo.setAttribute("src", preview);
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
    this.starting = true;
    this.error = undefined;
    this.submitted = false;
    this.pending = null;
    try {
      const quality = prop(this.node, "quality") ?? "720p";
      await this.engine.start(quality, this.selectedDeviceId);
    } catch (error) {
      if (!this.disposed) {
        this.error = captureErrorReason(error, "videoinput");
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
      if (blob.size === 0) {
        this.error = "没有录到画面";
        this.phase = "idle";
      } else {
        this.pending = blob;
        this.phase = "uploading";
      }
      this.render();
    }
    if (plan.submit) {
      void this.upload(blob, seconds);
    }
  }

  private async upload(blob: Blob, seconds: number): Promise<void> {
    if (!this.disposed) {
      this.error = undefined;
      this.phase = "uploading";
      this.render();
    }
    const attempt = await uploadRecorded(prop(this.node, "upload_url"), blob, this.disposed);
    const handler = this.handler();
    if (attempt.plan.submit && attempt.mediaId !== undefined && handler !== undefined) {
      this.submitted = true;
      this.ctx.event(handler, {
        media: attempt.mediaId,
        mime: blob.type || "video/webm",
        seconds,
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
      this.engine.clearPreview();
    }
    this.render();
  }

  private stop(): void {
    if (this.engine.isActive()) {
      this.engine.stop();
    }
  }

  private pause(): void {
    if (this.phase !== "recording" || !this.pausable()) {
      return;
    }
    this.engine.pause();
  }

  private resume(): void {
    if (this.phase !== "paused" || !this.pausable()) {
      return;
    }
    this.engine.resume();
  }

  private retry(): void {
    if (this.pending !== null) {
      void this.upload(this.pending, this.engine.seconds());
    }
  }
}
