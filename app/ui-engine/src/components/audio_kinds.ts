import type { Node } from "../core/types";
import { handlerOf } from "../dom/events";
import { defaultDeviceSource, openMediaStream } from "../capture/devices";
import type { KindRegistry, RenderContext } from "../dom/types";
import { clock, playQuietly, setHandler, stopTracks } from "./media_shared";
import { waveformKind } from "./waveform_kind";

/**
 * 音频组 kind：recorder（简单录音条）与 audio（播放按钮）。
 *
 * 行为对齐 legacy：recorder 录完把 base64 交给 on_submit，卸载时停录但不提交；
 * audio 按需从 media 服务取字节，全局只留一路播放。waveform 在 waveform_kind.ts，
 * 这里只在注册表里带上。
 */

/** 全局只留一路音频：点第二条时把上一条停掉（legacy 行为）。 */
let currentAudio: HTMLAudioElement | null = null;

/* ------------------------------------------------------------------ recorder */

class RecorderController {
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
      // 卸载时按 legacy 行为：停掉这段，不提交（Recorder 不是"录了即存"的捕捉条）。
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

class AudioController {
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
    const media = this.node.props["media"];
    const value = typeof media === "string" ? media : undefined;
    setHandler(this.el, value);
    this.el.disabled = value === undefined || value.length === 0;
  }

  private play(): void {
    const media = this.node.props["media"];
    const value = typeof media === "string" ? media : undefined;
    if (value === undefined || value.length === 0) {
      return;
    }
    void this.ctx
      .loadMedia(value)
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

/* ----------------------------------------------------------------------- map */

export const audioKinds: KindRegistry = {
  recorder: {
    create(node, ctx) {
      const el = document.createElement("div");
      const controller = new RecorderController(el, node, ctx);
      controllers.set(el, controller);
      ctx.cleanup(() => {
        controllers.delete(el);
        controller.dispose();
      });
      return el;
    },
    update(el, node) {
      updateNode(el, node);
    },
    childrenHosts() {
      return null;
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
      controllers.set(el, controller);
      ctx.cleanup(() => {
        controllers.delete(el);
        controller.dispose();
      });
      return el;
    },
    update(el, node) {
      updateNode(el, node);
    },
    childrenHosts() {
      return null;
    },
  },
  waveform: waveformKind,
};

const controllers = new WeakMap<HTMLElement, RecorderController | AudioController>();

function updateNode(el: HTMLElement, node: Node): void {
  controllers.get(el)?.update(node);
}
