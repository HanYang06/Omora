import { useCallback, useEffect, useRef, useState } from "react";
import { planStop } from "../capture-rules";
import { captureErrorReason, openMediaStream, type DeviceSource } from "../devices";
import { uploadRecorded } from "../media-upload";
import type { EventHandler } from "../../core/types";
import { useRecordTimer } from "../use-record-timer";
import { WARMUP_MS, videoBitrate, videoConstraints } from "./video-quality";

export type VideoMode = "idle" | "recording" | "paused" | "uploading" | "failed";

export interface VideoRecorderOptions {
  devices?: DeviceSource;
  refresh(): void;
  ready: boolean;
  pausable: boolean;
  maxSeconds: number;
  quality: string;
  selected?: string;
  handler?: string;
  uploadUrl?: string;
  onEvent?: EventHandler;
}

export interface VideoRecorder {
  mode: VideoMode;
  seconds: number;
  /** 录制中的实时预览流；暂停时仍是同一路 */
  stream: MediaStream | null;
  /** 刚录完的本地回放地址 */
  previewUrl?: string;
  error?: string;
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  retry(): void;
}

/**
 * video_capture 的录制机制：开流、预热、录像、暂停、上传、卸载即提交。
 * 只管行为，不管长什么样——界面在 video-capture.tsx。
 */
export function useVideoRecorder(options: VideoRecorderOptions): VideoRecorder {
  const {
    devices,
    refresh,
    ready,
    pausable,
    maxSeconds,
    quality,
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
    elapsed,
  } = timer;
  const [mode, setMode] = useState<VideoMode>("idle");
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const recordedSeconds = useRef(0);
  const unmounted = useRef(false);
  const submitted = useRef(false);
  const started = useRef(false);
  const preview = useRef<string | undefined>(undefined);
  /** 上传失败时留在原地的那份字节，重试用。 */
  const pending = useRef<Blob | null>(null);
  /** 卸载之后 onstop 还要发事件：回调从 ref 取最新的一份。 */
  const latest = useRef({ handler, onEvent, uploadUrl });

  useEffect(() => {
    latest.current = { handler, onEvent, uploadUrl };
  }, [handler, onEvent, uploadUrl]);

  /** 换预览地址：旧的先撤销，不然 blob 一直占着内存。 */
  const showPreview = useCallback((recorded: Blob | null) => {
    if (preview.current !== undefined) {
      URL.revokeObjectURL(preview.current);
      preview.current = undefined;
    }
    if (recorded === null) {
      setPreviewUrl(undefined);
      return;
    }
    preview.current = URL.createObjectURL(recorded);
    setPreviewUrl(preview.current);
  }, []);

  const release = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    stopTimer();
  }, [stopTimer]);

  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      if (preview.current !== undefined) {
        URL.revokeObjectURL(preview.current);
        preview.current = undefined;
      }
      const active = recorder.current;
      if (active !== null && active.state !== "inactive") {
        // 还在录：停下来交给 onstop 上传。这里只动 ref，不碰界面。
        active.stop();
        return;
      }
      release();
    };
  }, [release]);

  const stop = useCallback(() => {
    const active = recorder.current;
    if (active !== null && active.state !== "inactive") {
      active.stop();
    }
  }, []);

  /** 暂停：录像也停住，计时冻结；继续时把暂停的那段从时长里扣掉。 */
  const pause = useCallback(() => {
    const active = recorder.current;
    if (active === null || active.state !== "recording" || !pausable) {
      return;
    }
    try {
      active.pause();
    } catch (upstream) {
      console.error("[omora] 暂停失败:", upstream);
      return;
    }
    pauseTimer();
    setMode("paused");
  }, [pausable, pauseTimer]);

  const resume = useCallback(() => {
    const active = recorder.current;
    if (active === null || active.state !== "paused" || !pausable) {
      return;
    }
    try {
      active.resume();
    } catch (upstream) {
      console.error("[omora] 继续失败:", upstream);
      return;
    }
    resumeTimer();
    setMode("recording");
  }, [pausable, resumeTimer]);

  /** 字节 → HTTP 媒体通道 → on_submit；失败原地留着等重试。 */
  const upload = useCallback(
    async (recorded: Blob) => {
      const target = latest.current;
      if (!unmounted.current) {
        setError(undefined);
        setMode("uploading");
      }
      const { mediaId, plan } = await uploadRecorded(target.uploadUrl, recorded, unmounted.current);
      if (plan.submit && mediaId !== undefined && target.handler !== undefined) {
        submitted.current = true;
        target.onEvent?.(target.handler, {
          media: mediaId,
          mime: recorded.type || "video/webm",
          seconds: recordedSeconds.current,
        });
      }
      if (plan.log) {
        console.error("[omora] 视频没存上，组件已卸载，这段只留在内存里:", plan.reason);
      }
      if (!plan.updateUi) {
        return;
      }
      setError(plan.reason.length > 0 ? plan.reason : undefined);
      setMode(plan.phase);
      if (!plan.keepBlob) {
        pending.current = null;
        showPreview(null);
      }
    },
    [showPreview],
  );

  const start = useCallback(async () => {
    if (handler === undefined || !ready || started.current) {
      return;
    }
    started.current = true;
    setError(undefined);
    showPreview(null);
    submitted.current = false;
    recordedSeconds.current = 0;
    pending.current = null;
    try {
      const opened = await openMediaStream(devices, {
        video: videoConstraints(quality, selected),
        audio: false,
      });
      if (unmounted.current) {
        opened.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = opened;
      // 先让 ISP 收敛，别把开头那次亮度跳变录进去
      await new Promise((done) => {
        setTimeout(done, WARMUP_MS);
      });
      if (unmounted.current) {
        release();
        return;
      }
      const media = new MediaRecorder(opened, {
        videoBitsPerSecond: videoBitrate(quality),
      });
      chunks.current = [];
      media.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunks.current.push(event.data);
        }
      };
      media.onstop = () => {
        release();
        recordedSeconds.current = elapsed();
        const recorded = new Blob(chunks.current, { type: media.mimeType || "video/webm" });
        const plan = planStop({
          submitted: submitted.current,
          hasData: recorded.size > 0,
          hasHandler: latest.current.handler !== undefined,
          unmounted: unmounted.current,
        });
        if (plan.updateUi) {
          if (recorded.size === 0) {
            setError("没有录到画面");
            setMode("idle");
          } else {
            pending.current = recorded;
            showPreview(recorded);
            setMode("uploading");
          }
        }
        if (plan.submit) {
          void upload(recorded);
        }
      };
      recorder.current = media;
      startTimer(maxSeconds, stop);
      setMode("recording");
      media.start();
      refresh();
    } catch (upstream) {
      release();
      if (unmounted.current) {
        return;
      }
      setError(captureErrorReason(upstream, "videoinput"));
      setMode("idle");
    } finally {
      started.current = false;
    }
  }, [
    devices,
    elapsed,
    handler,
    maxSeconds,
    quality,
    ready,
    refresh,
    release,
    selected,
    showPreview,
    startTimer,
    stop,
    upload,
  ]);

  const retry = useCallback(() => {
    if (pending.current === null) {
      return;
    }
    void upload(pending.current);
  }, [upload]);

  return {
    mode,
    seconds: timer.seconds,
    stream: stream.current,
    previewUrl,
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
