import { useCallback, useEffect, useRef, useState } from "react";
import { openAnalyser, type AnalyserTap } from "./audio-level";
import { PEAK_INTERVAL_MS, planStop, pushPeak } from "./capture-rules";
import { captureErrorReason, openMediaStream, type DeviceSource } from "./devices";
import { uploadRecorded } from "./media-upload";
import type { EventHandler } from "./types";
import { useRecordTimer } from "./use-record-timer";

export type AudioPhase = "idle" | "recording" | "paused" | "uploading" | "failed";

/** 一段录完、等着上传的音频：失败后重试要用同一份字节、同样的时长与峰值。 */
export interface PendingAudio {
  blob: Blob;
  seconds: number;
  peaks: number[];
}

export interface AudioRecorderOptions {
  devices?: DeviceSource;
  refresh(): void;
  /** 设备门禁 + 媒体通道都就绪 */
  ready: boolean;
  autostart: boolean;
  maxSeconds: number;
  quality: string;
  noiseReduction: boolean;
  selected?: string;
  handler?: string;
  uploadUrl?: string;
  onEvent?: EventHandler;
}

export interface AudioRecorder {
  phase: AudioPhase;
  seconds: number;
  /** 实时电平；暂停时不涨 */
  live: number[];
  error?: string;
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  retry(): void;
}

/**
 * audio_capture 的录制机制：开流、录音、实时电平、暂停、上传、卸载即提交。
 * 只管行为，不管长什么样——界面在 audio-capture.tsx。
 */
export function useAudioRecorder(options: AudioRecorderOptions): AudioRecorder {
  const {
    devices,
    refresh,
    ready,
    autostart,
    maxSeconds,
    quality,
    noiseReduction,
    selected,
    handler,
    uploadUrl,
    onEvent,
  } = options;
  const timer = useRecordTimer();
  const {
    stop: stopTimer,
    start: startTimer,
    pause: pauseTimer,
    resume: resumeTimer,
    paused: isPaused,
    elapsed,
  } = timer;
  const [phase, setPhase] = useState<AudioPhase>("idle");
  const [live, setLive] = useState<number[]>([]);
  const [pending, setPending] = useState<PendingAudio | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const tap = useRef<AnalyserTap | undefined>(undefined);
  const peaks = useRef<number[]>([]);
  const sampler = useRef<number | null>(null);
  const unmounted = useRef(false);
  const submitted = useRef(false);
  const starting = useRef(false);
  const autostarted = useRef(false);
  /** 卸载之后 onstop 还要发事件：回调从 ref 取最新的一份。 */
  const latest = useRef({ handler, onEvent, uploadUrl });

  useEffect(() => {
    latest.current = { handler, onEvent, uploadUrl };
  }, [handler, onEvent, uploadUrl]);

  /** 撤掉取样口与采样计时器；可重复调。 */
  const stopSampling = useCallback(() => {
    if (sampler.current !== null) {
      window.clearInterval(sampler.current);
      sampler.current = null;
    }
    tap.current?.close();
    tap.current = undefined;
  }, []);

  const release = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    stopTimer();
    stopSampling();
  }, [stopSampling, stopTimer]);

  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      const active = recorder.current;
      if (active !== null && active.state !== "inactive") {
        // 还在录：先停采样，再停下来交给 onstop 上传。这里只动 ref，不碰界面。
        stopSampling();
        active.stop();
        return;
      }
      release();
    };
  }, [release, stopSampling]);

  /** 字节 → HTTP 媒体通道 → on_submit；失败原地留着等重试。 */
  const upload = useCallback(async (recorded: Blob, length: number, recordedPeaks: number[]) => {
    const target = latest.current;
    if (!unmounted.current) {
      setError(undefined);
      setPhase("uploading");
    }
    const { mediaId, plan } = await uploadRecorded(target.uploadUrl, recorded, unmounted.current);
    if (plan.submit && mediaId !== undefined && target.handler !== undefined) {
      submitted.current = true;
      target.onEvent?.(target.handler, {
        media: mediaId,
        mime: recorded.type || "audio/webm",
        seconds: length,
        peaks: recordedPeaks,
      });
    }
    if (plan.log) {
      console.error("[omora] 音频没存上，组件已卸载，这段只留在内存里:", plan.reason);
    }
    if (!plan.updateUi) {
      return;
    }
    setError(plan.reason.length > 0 ? plan.reason : undefined);
    setPhase(plan.phase);
    setPending(
      plan.keepBlob ? { blob: recorded, seconds: length, peaks: recordedPeaks } : null,
    );
  }, []);

  const stop = useCallback(() => {
    const active = recorder.current;
    if (active !== null && active.state !== "inactive") {
      active.stop();
    }
  }, []);

  /** 采一根柱子；暂停中不采（暂停那段的静音不该被记进波形）。 */
  const sample = useCallback(() => {
    const current = tap.current;
    if (current === undefined || unmounted.current) {
      return;
    }
    peaks.current = pushPeak(peaks.current, current.sample());
    setLive(peaks.current);
  }, []);

  const start = useCallback(async () => {
    if (handler === undefined || !ready || starting.current) {
      return;
    }
    starting.current = true;
    setError(undefined);
    setPending(null);
    submitted.current = false;
    const audio: MediaTrackConstraints = {
      echoCancellation: noiseReduction,
      noiseSuppression: noiseReduction,
      autoGainControl: true,
    };
    if (selected !== undefined && selected.length > 0) {
      audio.deviceId = { ideal: selected };
    }
    try {
      const opened = await openMediaStream(devices, { audio });
      if (unmounted.current) {
        // 等权限的时候人已经走了：别偷偷录下去，麦克风也别占着
        opened.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = opened;
      const options: MediaRecorderOptions =
        quality === "low" ? { audioBitsPerSecond: 64000 } : {};
      const media = new MediaRecorder(opened, options);
      chunks.current = [];
      peaks.current = [];
      setLive([]);
      media.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunks.current.push(event.data);
        }
      };
      media.onstop = () => {
        release();
        const length = elapsed();
        const recordedPeaks = peaks.current;
        const recorded = new Blob(chunks.current, { type: media.mimeType || "audio/webm" });
        const plan = planStop({
          submitted: submitted.current,
          hasData: recorded.size > 0,
          hasHandler: latest.current.handler !== undefined,
          unmounted: unmounted.current,
        });
        if (plan.updateUi) {
          if (recorded.size === 0) {
            setError("没有录到声音");
            setPhase("idle");
          } else {
            setPhase("uploading");
          }
        }
        if (plan.submit) {
          void upload(recorded, length, recordedPeaks);
        }
      };
      recorder.current = media;
      startTimer(maxSeconds, stop);
      setPhase("recording");
      if (autostart) {
        autostarted.current = true;
      }
      media.start();
      tap.current = openAnalyser(opened);
      if (tap.current !== undefined) {
        sampler.current = window.setInterval(() => {
          if (!isPaused()) {
            sample();
          }
        }, PEAK_INTERVAL_MS);
      }
      refresh();
    } catch (upstream) {
      release();
      if (unmounted.current) {
        return;
      }
      setError(captureErrorReason(upstream, "audioinput"));
      setPhase("idle");
    } finally {
      starting.current = false;
    }
  }, [
    autostart,
    devices,
    elapsed,
    handler,
    isPaused,
    maxSeconds,
    noiseReduction,
    quality,
    ready,
    refresh,
    release,
    sample,
    selected,
    startTimer,
    stop,
    upload,
  ]);

  /** autostart 只在真开起来之后算数；等设备枚举完、通道就绪才起手。 */
  useEffect(() => {
    if (!autostart || !ready || autostarted.current || starting.current) {
      return;
    }
    void start();
  }, [autostart, ready, start]);

  const pause = useCallback(() => {
    const active = recorder.current;
    if (active === null || active.state !== "recording") {
      return;
    }
    try {
      active.pause();
    } catch (upstream) {
      console.error("[omora] 暂停失败:", upstream);
      return;
    }
    pauseTimer();
    setPhase("paused");
  }, [pauseTimer]);

  const resume = useCallback(() => {
    const active = recorder.current;
    if (active === null || active.state !== "paused") {
      return;
    }
    try {
      active.resume();
    } catch (upstream) {
      console.error("[omora] 继续失败:", upstream);
      return;
    }
    resumeTimer();
    setPhase("recording");
  }, [resumeTimer]);

  const retry = useCallback(() => {
    if (pending === null) {
      return;
    }
    void upload(pending.blob, pending.seconds, pending.peaks);
  }, [pending, upload]);

  return {
    phase,
    seconds: timer.seconds,
    live,
    error,
    start: () => {
      void start();
    },
    stop,
    pause,
    resume,
    retry,
  };
}