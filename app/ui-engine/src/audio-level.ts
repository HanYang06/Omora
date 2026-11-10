import { rmsToPeak } from "./capture-rules";

/** 实时电平的取样口。没有 Web Audio 就不给，录音照常。 */
export interface AnalyserTap {
  /** 读一次时域 RMS，返回 0–100 的柱高 */
  sample(): number;
  close(): void;
}

/** 开一个 AnalyserNode 挂在录音流上；起不来就返回 undefined，别为了波形把录音弄挂。 */
export function openAnalyser(stream: MediaStream): AnalyserTap | undefined {
  if (typeof AudioContext === "undefined") {
    return undefined;
  }
  try {
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    const buffer = new Float32Array(analyser.fftSize);
    void context.resume().catch(() => undefined);
    return {
      sample(): number {
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (const value of buffer) {
          sum += value * value;
        }
        return rmsToPeak(Math.sqrt(sum / buffer.length));
      },
      close(): void {
        void context.close().catch(() => undefined);
      },
    };
  } catch (error) {
    console.error("[omora] 波形起不来:", error);
    return undefined;
  }
}
