import { useCallback, useEffect, useRef, useState } from "react";
import type WaveSurfer from "wavesurfer.js";
import type RecordPlugin from "wavesurfer.js/dist/plugins/record.js";
import type { EventHandler } from "../../core/types";
import { planStop } from "../capture-rules";
import { uploadRecorded } from "../media-upload";

export type AudioPhase = "idle" | "recording" | "paused" | "uploading" | "failed";

/** 波形观感：和 styles 里的 accent 一档，别在两端各写一份色值。 */
const ACCENT = "#27664b";
const ACCENT_STRONG = "#1e523c";

/** 实时波形看最近多少秒。 */
const WAVE_WINDOW_SECONDS = 10;

export interface AudioRecorderOptions {
  container: React.RefObject<HTMLDivElement | null>;
  ready: boolean;
  autostart: boolean;
  maxSeconds: number;
  quality: string;
  deviceId?: string;
  handler?: string;
  uploadUrl?: string;
  onEvent?: EventHandler;
}

let loading: Promise<[typeof WaveSurfer, typeof RecordPlugin]> | null = null;

/** 静态引入会让 node 环境的测试直接炸；用到时再拉，只拉一次。 */
function loadLibrary(): Promise<[typeof WaveSurfer, typeof RecordPlugin]> {
  if (loading === null) {
    loading = Promise.all([
      import("wavesurfer.js"),
      import("wavesurfer.js/dist/plugins/record.js"),
    ]).then(([wave, record]) => [wave.default, record.default]);
  }
  return loading;
}

/**
 * 录音：MediaRecorder、实时波形、暂停全交给 wavesurfer 的 record 插件，
 * 这里只管 Omora 自己的那几步 —— 设备门禁、上传、失败重试、卸载即提交。
 */
export function useAudioRecorder(options: AudioRecorderOptions) {
  const {
    container,
    ready,
    autostart,
    maxSeconds,
    quality,
    deviceId,
    handler,
    uploadUrl,
    onEvent,
  } = options;
  const [phase, setPhase] = useState<AudioPhase>("idle");
  const [seconds, setSeconds] = useState(0);
  /** wavesurfer 是异步加载的：加载完之前不能开录，否则 autostart 会扑空。 */
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const wavesurfer = useRef<WaveSurfer | null>(null);
  const record = useRef<RecordPlugin | null>(null);
  const pending = useRef<{ blob: Blob; seconds: number } | null>(null);
  const submitted = useRef(false);
  const unmounted = useRef(false);
  const latest = useRef({ handler, uploadUrl, onEvent });
  const limit = useRef(maxSeconds);

  useEffect(() => {
    latest.current = { handler, uploadUrl, onEvent };
  }, [handler, uploadUrl, onEvent]);

  useEffect(() => {
    limit.current = maxSeconds;
  }, [maxSeconds]);

  /** 交给 on_submit；失败就停在失败态，字节还在内存里等重试。 */
  const upload = useCallback(async (blob: Blob, length: number) => {
    const target = latest.current;
    if (!unmounted.current) {
      setPhase("uploading");
      setError(undefined);
    }
    const attempt = await uploadRecorded(target.uploadUrl, blob, unmounted.current);
    const plan = attempt.plan;
    const mediaId = attempt.mediaId;
    if (plan.submit && mediaId !== undefined && target.handler !== undefined) {
      submitted.current = true;
      target.onEvent?.(target.handler, {
        media: mediaId,
        mime: blob.type || "audio/webm",
        seconds: length,
      });
    }
    if (plan.log) {
      console.error("[omora] 录音没存上，组件已卸载，这段只留在内存里:", plan.reason);
    }
    pending.current = plan.keepBlob ? { blob, seconds: length } : null;
    if (!plan.updateUi) {
      return;
    }
    setError(plan.reason.length > 0 ? plan.reason : undefined);
    setPhase(plan.phase);
  }, []);

  /** record-end：算时长、按规则决定要不要交，然后销毁波形实例。 */
  const settle = useCallback(
    (blob: Blob) => {
      const length = (record.current?.getDuration() ?? 0) / 1000;
      const plan = planStop({
        submitted: submitted.current,
        hasData: blob.size > 0,
        hasHandler: latest.current.handler !== undefined,
        unmounted: unmounted.current,
      });
      if (plan.updateUi) {
        setPhase("idle");
      }
      if (plan.submit) {
        void upload(blob, length);
      }
    },
    [upload],
  );

  useEffect(() => {
    unmounted.current = false;
    let disposed = false;

    void loadLibrary().then(([WaveSurferClass, RecordClass]) => {
      if (disposed || container.current === null) {
        return;
      }
      const wave = WaveSurferClass.create({
        container: container.current,
        height: 56,
        waveColor: ACCENT,
        progressColor: ACCENT_STRONG,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        cursorWidth: 0,
        interact: false,
        normalize: true,
      });
      const plugin = wave.registerPlugin(
        RecordClass.create({
          mimeType: "audio/webm",
          audioBitsPerSecond: quality === "low" ? 64000 : 128000,
          scrollingWaveform: true,
          scrollingWaveformWindow: WAVE_WINDOW_SECONDS,
          renderRecordedAudio: false,
        }),
      );
      wavesurfer.current = wave;
      record.current = plugin;
      setLoaded(true);

      // wavesurfer 的进度是毫秒；Omora 这边一律按秒。
      plugin.on("record-progress", (millis: number) => {
        if (unmounted.current) {
          return;
        }
        const duration = millis / 1000;
        setSeconds(duration);
        if (limit.current > 0 && duration >= limit.current) {
          plugin.stopRecording();
        }
      });
      plugin.on("record-pause", () => {
        if (!unmounted.current) {
          setPhase("paused");
        }
      });
      plugin.on("record-resume", () => {
        if (!unmounted.current) {
          setPhase("recording");
        }
      });
      plugin.on("record-end", (blob: Blob) => {
        settle(blob);
        if (unmounted.current) {
          wave.destroy();
        }
      });
    });

    return () => {
      disposed = true;
      unmounted.current = true;
      const plugin = record.current;
      const wave = wavesurfer.current;
      record.current = null;
      wavesurfer.current = null;
      if (plugin === null || wave === null) {
        return;
      }
      if (plugin.isActive()) {
        // 还在录：停下来，等 record-end 传完再销毁；组件已经没了，回调只发事件。
        plugin.stopRecording();
        return;
      }
      wave.destroy();
    };
  }, [container, quality, settle]);

  const start = useCallback(async () => {
    const plugin = record.current;
    if (plugin === null || !ready) {
      return;
    }
    setError(undefined);
    submitted.current = false;
    pending.current = null;
    try {
      await plugin.startRecording(deviceId === undefined ? {} : { deviceId: { ideal: deviceId } });
      if (!unmounted.current) {
        setPhase("recording");
      }
    } catch (upstream) {
      if (!unmounted.current) {
        setError(captureReason(upstream));
        setPhase("idle");
      }
    }
  }, [deviceId, ready]);

  // 按住空格进来的：波形库加载完、设备就绪之后立刻开录。
  useEffect(() => {
    if (!autostart || !ready || !loaded) {
      return;
    }
    void start();
  }, [autostart, loaded, ready, start]);

  const stop = useCallback(() => {
    record.current?.stopRecording();
  }, []);

  const pause = useCallback(() => {
    record.current?.pauseRecording();
  }, []);

  const resume = useCallback(() => {
    record.current?.resumeRecording();
  }, []);

  const retry = useCallback(() => {
    const last = pending.current;
    if (last !== null) {
      void upload(last.blob, last.seconds);
    }
  }, [upload]);

  return { phase, seconds, error, start, stop, pause, resume, retry };
}

function captureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 0 ? message : "打不开麦克风";
}
