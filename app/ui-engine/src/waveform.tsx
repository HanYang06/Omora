import type { ReactNode } from "react";
import { clock, type NodeComponentProps } from "./shared";

/**
 * peaks 是 Python 侧的 tuple[int]（0–100）。坏数据别把柱子画到框外：
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

/** 一排柱子；实时电平和静态波形共用。高度是百分比，容器给固定高度。 */
export function PeakBars({ peaks }: { peaks: readonly number[] }): ReactNode {
  return (
    <span className="omora-peaks" aria-hidden="true">
      {peaks.map((peak, index) => (
        <span
          key={index}
          className="omora-peak"
          style={{ height: `${Math.min(100, Math.max(0, peak))}%` }}
        />
      ))}
    </span>
  );
}

/**
 * waveform：一条静态波形。只负责看，不负责播（播放是 Audio）。
 * 时长用和计时一样的 clock 格式（M:SS），放在柱子旁边。
 */
/** 少于这个数就把柱子重复展开：三秒钟几根柱子横铺一整条看着像虚线。 */
const MIN_BARS = 120;

/** 展开到至少 MIN_BARS 根；超过就不动。 */
export function spreadBars(bars: readonly number[]): number[] {
  if (bars.length === 0 || bars.length >= MIN_BARS) {
    return [...bars];
  }
  const times = Math.ceil(MIN_BARS / bars.length);
  const out: number[] = [];
  for (const bar of bars) {
    for (let i = 0; i < times; i += 1) {
      out.push(bar);
    }
  }
  return out;
}

export function Waveform({ node }: NodeComponentProps): ReactNode {
  const bars = waveformBars(node.props?.peaks);
  const rawSeconds = node.props?.seconds;
  const seconds =
    typeof rawSeconds === "number" && Number.isFinite(rawSeconds) ? rawSeconds : 0;

  return (
    <div className="omora-waveform" data-type="waveform" data-bars={bars.length}>
      <PeakBars peaks={spreadBars(bars)} />
      <span className="omora-waveform-seconds">{clock(seconds)}</span>
    </div>
  );
}
