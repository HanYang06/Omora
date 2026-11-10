import { useEffect, useRef, type ReactNode } from "react";
import type WaveSurfer from "wavesurfer.js";
import { prop, type NodeComponentProps } from "../core/shared";

/** 波形观感：和 styles 里的 accent 一档。 */
const ACCENT = "#27664b";
const ACCENT_STRONG = "#1e523c";

let loading: Promise<typeof WaveSurfer> | null = null;

/** 静态引入会让 node 环境的测试直接炸；用到时再拉，只拉一次。 */
function loadWaveSurfer(): Promise<typeof WaveSurfer> {
  if (loading === null) {
    loading = import("wavesurfer.js").then((module) => module.default);
  }
  return loading;
}

/**
 * waveform：一条静态波形，画的是媒体通道里的那条音频。
 *
 * 只负责看，不负责播（播放是 Audio 按钮）；点波形不会跳，交互关掉。
 */
export function Waveform({ node }: NodeComponentProps): ReactNode {
  const src = prop(node, "src") ?? "";
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (src.length === 0) {
      return;
    }
    let disposed = false;
    let wave: WaveSurfer | null = null;
    void loadWaveSurfer().then((WaveSurferClass) => {
      if (disposed || box.current === null) {
        return;
      }
      wave = WaveSurferClass.create({
        container: box.current,
        url: src,
        height: 32,
        waveColor: ACCENT,
        progressColor: ACCENT_STRONG,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        cursorWidth: 0,
        interact: false,
        normalize: true,
      });
    });
    return () => {
      disposed = true;
      wave?.destroy();
    };
  }, [src]);

  return <div className="omora-waveform" data-type="waveform" data-src={src} ref={box} />;
}
