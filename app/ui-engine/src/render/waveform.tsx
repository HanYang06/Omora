import type { ReactNode } from "react";
import { clock, type NodeComponentProps } from "../core/shared";

/** 峰值是 Python 侧的 tuple[int]（0–100）。坏数据别把波形画到框外：
 * 非数字丢掉、越界夹回 0–100、小数取整。
 */
export function waveformBars(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const bars: number[] = [];
  for (const item of value) {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      continue;
    }
    bars.push(Math.min(100, Math.max(0, Math.round(item))));
  }
  return bars;
}

/** 画布高度：和中线一起定死，只让宽度随柱子数伸缩。 */
const HEIGHT = 100;
const MIDDLE = 50;

/**
 * 峰值 → 两条路径：一条合并的镜像面积（上下对称），一条顶部折线。
 *
 * 峰值是采样出来的「音量」（0–100），不是音频曲线；镜像画出来才像录音软件里的波形，
 * 单边柱状图看着像直方图。宽度等于柱子数，靠 preserveAspectRatio="none" 铺满容器，
 * 所以滑窗只要换 peaks 就行，不用改布局。
 */
export function wavePaths(peaks: readonly number[]): { area: string; line: string } {
  if (peaks.length === 0) {
    return { area: "", line: "" };
  }
  const width = peaks.length;
  const top: string[] = [];
  const bottom: string[] = [];

  peaks.forEach((raw, index) => {
    const half = Math.min(100, Math.max(0, raw)) / 2;
    const x = ((index + 0.5) * width) / peaks.length;
    top.push(`${x.toFixed(2)},${(MIDDLE - half).toFixed(2)}`);
    bottom.push(`${x.toFixed(2)},${(MIDDLE + half).toFixed(2)}`);
  });

  return {
    area: `M${top.join(" L")} L${bottom.reverse().join(" L")} Z`,
    line: `M${top.join(" L")}`,
  };
}

/** 一条波形。live 只影响描边深浅，形状一样。 */
export function WaveformChart({
  peaks,
  live = false,
}: {
  peaks: readonly number[];
  live?: boolean;
}): ReactNode {
  const paths = wavePaths(peaks);

  return (
    <svg
      className={live ? "omora-wave omora-wave--live" : "omora-wave"}
      viewBox={`0 0 ${Math.max(peaks.length, 1)} ${HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      data-bars={peaks.length}
    >
      {paths.area === "" ? null : <path className="omora-wave-area" d={paths.area} />}
      {paths.line === "" ? null : (
        <path className="omora-wave-line" d={paths.line} vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}

/**
 * waveform：一条静态波形。只负责看，不负责播（播放是 Audio）。
 * 时长用和计时一样的 clock 格式（M:SS），放在波形旁边。
 */
export function Waveform({ node }: NodeComponentProps): ReactNode {
  const bars = waveformBars(node.props?.peaks);
  const rawSeconds = node.props?.seconds;
  const seconds =
    typeof rawSeconds === "number" && Number.isFinite(rawSeconds) ? rawSeconds : 0;

  return (
    <div className="omora-waveform" data-type="waveform" data-bars={bars.length}>
      <WaveformChart peaks={bars} />
      <span className="omora-waveform-seconds">{clock(seconds)}</span>
    </div>
  );
}
