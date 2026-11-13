import type { Node } from "../core/types";
import type { Kind, KindRegistry, RenderContext } from "../dom/types";
import { AudioCaptureController } from "./audio_capture_kind";
import { VideoCaptureController } from "./video_capture_kind";

/**
 * 捕捉组 kind 的注册表：audio_capture / video_capture。
 *
 * 两个控制器各自一个文件（都带设备门禁、预览 / 波形与上传），这里只拼 map，
 * 不塞逻辑。
 */

const audioControllers = new WeakMap<HTMLElement, AudioCaptureController>();
const videoControllers = new WeakMap<HTMLElement, VideoCaptureController>();

const audioCapture: Kind = {
  create(node: Node, ctx: RenderContext) {
    const el = document.createElement("div");
    const controller = new AudioCaptureController(el, node, ctx);
    audioControllers.set(el, controller);
    ctx.cleanup(() => {
      audioControllers.delete(el);
      controller.dispose();
    });
    return el;
  },
  update(el, node) {
    audioControllers.get(el)?.update(node);
  },
  childrenHosts() {
    return null;
  },
};

const videoCapture: Kind = {
  create(node: Node, ctx: RenderContext) {
    const el = document.createElement("div");
    const controller = new VideoCaptureController(el, node, ctx);
    videoControllers.set(el, controller);
    ctx.cleanup(() => {
      videoControllers.delete(el);
      controller.dispose();
    });
    return el;
  },
  update(el, node) {
    videoControllers.get(el)?.update(node);
  },
  childrenHosts() {
    return null;
  },
};

export const captureKinds: KindRegistry = {
  audio_capture: audioCapture,
  video_capture: videoCapture,
};
