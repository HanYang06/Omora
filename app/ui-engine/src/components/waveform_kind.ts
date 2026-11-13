import type { Node } from "../core/types";
import type { Kind } from "../renderer/types";
import { loadWaveSurfer, prop, WAVE_COLOR, WAVE_PROGRESS_COLOR } from "./media_shared";

/**
 * waveform：一条静态波形，画的是媒体通道里的那条音频。
 *
 * 只负责看，不负责播（播放是 audio 按钮）；点波形不跳，交互关掉。
 * wavesurfer 按需动态加载；src 变了才销毁重建，其余更新不碰实例。
 */

interface WaveformState {
  node: Node;
  src: string | null;
  wave: { destroy(): void } | null;
  generation: number;
  disposed: boolean;
}

const waveforms = new WeakMap<HTMLElement, WaveformState>();

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

export const waveformKind: Kind = {
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
  childrenHosts() {
    return null;
  },
};
