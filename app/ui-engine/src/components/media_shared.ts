import {
  captureGate,
  createDeviceTracker,
  defaultDeviceSource,
  deviceLabel,
  type DeviceInfo,
  type DeviceKind,
  type DeviceState,
  type DeviceTracker,
  type Gate,
} from "../capture/devices";
import type WaveSurfer from "wavesurfer.js";
import type { Node } from "../core/types";

/**
 * 媒体 / 捕捉组共用的 DOM 小工具：props 读取、时钟、文本、handler、播放、
 * 对象 URL、设备门禁与 wavesurfer 懒加载。这里不画任何 kind。
 */

export type CapturePhase = "idle" | "recording" | "paused" | "uploading" | "failed";

/** 波形观感：和 styles 里的 accent 一档，别在两端各写一份色值。 */
export const WAVE_COLOR = "#27664b";
export const WAVE_PROGRESS_COLOR = "#1e523c";

export function prop(node: Node, name: string): string | undefined {
  const value = node.props[name];
  return typeof value === "string" ? value : undefined;
}

export function flag(node: Node, name: string): boolean {
  return node.props[name] === true;
}

export function numberProp(node: Node, name: string, fallback: number): number {
  const value = node.props[name];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const rest = String(total % 60).padStart(2, "0");
  return minutes + ":" + rest;
}

/** 只在文本真的变了才写，避免每次 tick 都换一次文本节点。 */
export function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) {
    el.textContent = text;
  }
}

export function setHandler(el: HTMLElement, handler: string | undefined): void {
  if (handler === undefined) {
    delete el.dataset.handler;
  } else {
    el.dataset.handler = handler;
  }
}

/** 捕捉条里的次要动作按钮（暂停 / 继续 / 重试），默认先藏起来。 */
export function actionButton(text: string, className = "omora-button"): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.hidden = true;
  return button;
}

export function stopTracks(stream: MediaStream | null): void {
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
export function playQuietly(media: HTMLMediaElement): void {
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
export function makeObjectUrl(blob: Blob): string | undefined {
  try {
    return URL.createObjectURL(blob);
  } catch (error) {
    console.error("[omora] 生成预览地址失败:", error);
    return undefined;
  }
}

export function revokeObjectUrl(url: string | undefined): void {
  if (url === undefined) {
    return;
  }
  try {
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("[omora] 释放预览地址失败:", error);
  }
}

export function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

/** 设备下拉：签名没变就不重建 option（保留用户打开状态）。 */
export function syncDeviceOptions(
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

/**
 * 设备门禁：枚举一次 + 跟着 devicechange 重枚举；门禁状态与设备清单从这里取。
 * 卸载时摘下 devicechange 监听。
 */
export class DeviceWatch {
  private readonly tracker: DeviceTracker;
  private state: DeviceState;
  private stopped = false;

  constructor(private readonly onChange: (state: DeviceState) => void) {
    this.tracker = createDeviceTracker(defaultDeviceSource(), (state) => {
      this.state = state;
      if (!this.stopped) {
        this.onChange(state);
      }
    });
    this.state = this.tracker.state;
  }

  /** 挂上之后主动枚举一次；枚举结果的回调由构造时传入。 */
  watch(): void {
    this.refresh();
  }

  refresh(): void {
    if (!this.stopped) {
      void this.tracker.refresh();
    }
  }

  gate(kind: DeviceKind): Gate {
    return captureGate(this.state, kind);
  }

  dispose(): void {
    this.stopped = true;
    this.tracker.stop();
  }
}

let waveSurferLoading: Promise<typeof WaveSurfer> | null = null;

/** 静态引入会让 node 环境的测试直接炸；用到时再拉，只拉一次。 */
export function loadWaveSurfer(): Promise<typeof WaveSurfer> {
  if (waveSurferLoading === null) {
    waveSurferLoading = import("wavesurfer.js").then((module) => module.default);
  }
  return waveSurferLoading;
}
