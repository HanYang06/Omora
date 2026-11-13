import type { Node } from "../core/types";
import type { Kind, KindRegistry } from "../dom/types";
import { prop, setText } from "./media_shared";

/**
 * video：一条视频。有 src 就出 <video controls>，没有就出"媒体通道未就绪"。
 *
 * 用 display: contents 的 span 包装，missing ↔ video 可以原地切换，内部 markup
 * 与 legacy 一致（data-type / data-media 都在真正的节点上）。
 */

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

const video: Kind = {
  create(node) {
    const wrapper = document.createElement("span");
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
  childrenHosts() {
    return null;
  },
};

export const videoKinds: KindRegistry = {
  video,
};
