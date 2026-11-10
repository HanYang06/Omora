import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  captureErrorReason,
  captureGate,
  openMediaStream,
} from "./devices";
import { DeviceSelect } from "./device-select";
import { LiveVideo } from "./live-video";
import { numberProp } from "./audio-capture";
import { planStop, planUpload, uploadFailureReason } from "./capture-rules";
import { uploadMedia } from "./media";
import { clock, prop, type NodeComponentProps } from "./shared";
import { useMediaDevices } from "./use-devices";
import { DEFAULT_SECONDS, WARMUP_MS, videoBitrate, videoConstraints } from "./video-quality";

/** 录完直接上传，没有回看，也没有"保存"这一步。 */
type Mode = "idle" | "recording" | "uploading" | "failed";

/**
 * video_capture：视频捕捉条。
 *
 * 设备与权限在客户端；录的时候有实时预览。停下来就上传 HTTP 媒体通道，成功即存，
 * 事件里只带 media id。上传失败不提交，字节留在原地等重试；卸载时正在录，也把这段
 * 停掉、传完、交出去——尽力而为，失败就只剩日志（这版没有重试队列）。
 */
export function VideoCapture({ node, onEvent, devices }: NodeComponentProps): ReactNode {
  const handler = prop(node, "on_submit");
  const uploadUrl = prop(node, "upload_url");
  const quality = prop(node, "quality") ?? "720p";
  const maxSeconds = numberProp(node, "max_seconds", DEFAULT_SECONDS);
  const { state, refresh } = useMediaDevices(devices);
  const camera = captureGate(state, "videoinput");
  const ready = camera.enabled && uploadUrl !== undefined && handler !== undefined;
  const reason = camera.enabled ? "媒体通道未就绪" : camera.reason;
  const [mode, setMode] = useState<Mode>("idle");
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const elapsed = useRef(0);
  const ticker = useRef<number | null>(null);
  const unmounted = useRef(false);
  const submitted = useRef(false);
  const preview = useRef<string | undefined>(undefined);
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
    if (ticker.current !== null) {
      window.clearInterval(ticker.current);
      ticker.current = null;
    }
  }, []);

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

  /** 字节 → HTTP 媒体通道 → on_submit；失败原地留着等重试。 */
  const upload = useCallback(async (recorded: Blob, length: number) => {
    const target = latest.current;
    if (!unmounted.current) {
      setError(undefined);
      setMode("uploading");
    }
    let mediaId: string | undefined;
    let failure: unknown;
    try {
      if (target.uploadUrl === undefined || target.handler === undefined) {
        throw new Error("媒体通道未就绪");
      }
      mediaId = await uploadMedia((url, init) => fetch(url, init), target.uploadUrl, recorded);
    } catch (upstream) {
      failure = upstream;
    }
    const plan = planUpload({
      ok: mediaId !== undefined,
      reason: uploadFailureReason(failure),
      unmounted: unmounted.current,
    });
    if (plan.submit && mediaId !== undefined && target.handler !== undefined) {
      submitted.current = true;
      target.onEvent?.(target.handler, {
        media: mediaId,
        mime: recorded.type || "video/webm",
        seconds: length,
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
      setBlob(null);
      showPreview(null);
    }
  }, [showPreview]);

  const start = useCallback(async () => {
    if (handler === undefined || !ready) {
      return;
    }
    setError(undefined);
    setBlob(null);
    showPreview(null);
    submitted.current = false;
    try {
      const opened = await openMediaStream(devices, {
        video: videoConstraints(quality, selected),
        audio: false,
      });
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
        elapsed.current = (Date.now() - started.current) / 1000;
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
            setBlob(recorded);
            showPreview(recorded);
            setMode("uploading");
          }
        }
        if (plan.submit) {
          void upload(recorded, elapsed.current);
        }
      };
      recorder.current = media;
      started.current = Date.now();
      setSeconds(0);
      setMode("recording");
      ticker.current = window.setInterval(() => {
        const running = Math.floor((Date.now() - started.current) / 1000);
        setSeconds(running);
        if (running >= maxSeconds) {
          stop();
        }
      }, 250);
      media.start();
      refresh();
    } catch (upstream) {
      release();
      if (unmounted.current) {
        return;
      }
      setError(captureErrorReason(upstream, "videoinput"));
      setMode("idle");
    }
  }, [devices, handler, maxSeconds, quality, ready, refresh, release, showPreview, selected, stop, upload]);

  const retry = useCallback(() => {
    if (blob === null) {
      return;
    }
    void upload(blob, elapsed.current);
  }, [blob, upload]);

  const hint = ready
    ? error ?? (mode === "uploading" ? "上传中…" : "摄像头只在你点的时候打开")
    : reason;

  return (
    <div
      className="omora-video-bar"
      data-type="video_capture"
      data-gate={ready ? "on" : "off"}
      data-mode={mode}
    >
      {mode === "recording" ? <LiveVideo stream={stream.current} /> : null}
      {previewUrl !== undefined ? (
        <video className="omora-video" src={previewUrl} controls playsInline />
      ) : null}
      <div className="omora-video-actions">
        {mode === "idle" ? (
          <button
            type="button"
            className="omora-record"
            data-handler={handler}
            disabled={!ready}
            onClick={() => void start()}
          >
            <span className="omora-record-dot" aria-hidden="true" />
            录视频
          </button>
        ) : null}
        {mode === "recording" ? (
          <button type="button" className="omora-record is-recording" onClick={stop}>
            {clock(seconds)} 停止
          </button>
        ) : null}
        {mode === "failed" ? (
          <button type="button" className="omora-record" onClick={retry}>
            重试
          </button>
        ) : null}
        {ready && mode === "idle" && camera.devices.length > 1 ? (
          <DeviceSelect
            devices={camera.devices}
            kind="videoinput"
            value={selected ?? camera.devices[0]?.deviceId}
            onChange={setSelected}
          />
        ) : null}
        <span className="omora-record-hint">{hint}</span>
      </div>
    </div>
  );
}
