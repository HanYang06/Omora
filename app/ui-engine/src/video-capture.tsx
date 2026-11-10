import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  captureErrorReason,
  captureGate,
  openMediaStream,
} from "./devices";
import { DeviceSelect } from "./device-select";
import { numberProp } from "./audio-capture";
import { uploadMedia } from "./media";
import { clock, prop, type NodeComponentProps } from "./shared";
import { useMediaDevices } from "./use-devices";

const QUALITY_SIZE: Record<string, { width: number; height: number }> = {
  "480p": { width: 640, height: 480 },
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
};
const DEFAULT_SECONDS = 120;

type Mode = "idle" | "recording" | "review" | "uploading";

/**
 * 录制时的实时预览。
 *
 * 只把 stream 挂到 srcObject 上是不够的：video 不会自己开播，画面就一直是黑的。
 * 要 autoPlay + muted（静音才允许自动播），拿到流之后补一次 play()。
 */
export function LiveVideo({ stream }: { stream: MediaStream | null }): ReactNode {
  const element = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = element.current;
    if (video === null) {
      return;
    }
    video.srcObject = stream;
    if (stream !== null) {
      void video.play().catch(() => {
        // 自动播放被拦时留黑帧，不弹错：用户还能停、能保存
      });
    }
  }, [stream]);

  return (
    <video
      className="omora-video"
      data-type="video-live"
      ref={element}
      autoPlay
      muted
      playsInline
    />
  );
}

/**
 * video_capture：视频捕捉条。
 *
 * 设备与权限在客户端；录的时候有实时预览，停下来的先给一次回看——满意再保存，
 * 不满意就重录。保存 = POST 到 HTTP 媒体通道拿 media_id，事件里只带 id。
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
  const timer = useRef<number | null>(null);
  const cancelled = useRef(false);

  const clearPreview = useCallback(() => {
    setPreviewUrl((current) => {
      if (current !== undefined) {
        URL.revokeObjectURL(current);
      }
      return undefined;
    });
  }, []);

  const release = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
      const active = recorder.current;
      if (active !== null && active.state !== "inactive") {
        active.stop();
      }
      release();
      clearPreview();
    };
  }, [clearPreview, release]);

  const stop = useCallback(() => {
    const active = recorder.current;
    if (active !== null && active.state !== "inactive") {
      active.stop();
    }
  }, []);

  const start = useCallback(async () => {
    if (handler === undefined || !ready) {
      return;
    }
    setError(undefined);
    setBlob(null);
    clearPreview();
    const size = QUALITY_SIZE[quality] ?? QUALITY_SIZE["720p"];
    const video: MediaTrackConstraints = {
      width: { ideal: size?.width ?? 1280 },
      height: { ideal: size?.height ?? 720 },
    };
    if (selected !== undefined && selected.length > 0) {
      video.deviceId = { ideal: selected };
    }
    try {
      const opened = await openMediaStream(devices, { video, audio: false });
      stream.current = opened;
      const media = new MediaRecorder(opened);
      chunks.current = [];
      media.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunks.current.push(event.data);
        }
      };
      media.onstop = () => {
        release();
        setMode("review");
        if (cancelled.current) {
          return;
        }
        if (chunks.current.length === 0) {
          setError("没有录到画面");
          setMode("idle");
          return;
        }
        const recorded = new Blob(chunks.current, { type: media.mimeType || "video/webm" });
        setBlob(recorded);
        setPreviewUrl((current) => {
          if (current !== undefined) {
            URL.revokeObjectURL(current);
          }
          return URL.createObjectURL(recorded);
        });
      };
      recorder.current = media;
      started.current = Date.now();
      setSeconds(0);
      setMode("recording");
      timer.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - started.current) / 1000);
        setSeconds(elapsed);
        if (elapsed >= maxSeconds) {
          stop();
        }
      }, 250);
      media.start();
      refresh();
    } catch (error) {
      setError(captureErrorReason(error, "videoinput"));
      release();
      setMode("idle");
    }
  }, [devices, clearPreview, handler, maxSeconds, quality, ready, refresh, release, selected, stop]);

  const retake = useCallback(() => {
    setBlob(null);
    setError(undefined);
    clearPreview();
    setMode("idle");
  }, [clearPreview]);

  const save = useCallback(async () => {
    if (blob === null || uploadUrl === undefined || handler === undefined) {
      return;
    }
    setError(undefined);
    setMode("uploading");
    try {
      const mediaId = await uploadMedia((url, init) => fetch(url, init), uploadUrl, blob);
      onEvent?.(handler, { media: mediaId, mime: blob.type || "video/webm", seconds });
      setMode("idle");
      setBlob(null);
      clearPreview();
    } catch (upstream) {
      setError(upstream instanceof Error ? upstream.message : "上传失败");
      setMode("review");
    }
  }, [blob, clearPreview, handler, onEvent, seconds, uploadUrl]);

  return (
    <div className="omora-video-bar" data-type="video_capture" data-gate={ready ? "on" : "off"}>
      {mode === "recording" ? <LiveVideo stream={stream.current} /> : null}
      {mode === "review" && previewUrl !== undefined ? (
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
        {mode === "review" ? (
          <>
            <button type="button" className="omora-record" onClick={() => void save()}>
              保存
            </button>
            <button type="button" className="omora-record" onClick={retake}>
              重录
            </button>
          </>
        ) : null}
        {mode === "uploading" ? <span className="omora-record-hint">上传中…</span> : null}
        {ready && mode === "idle" && camera.devices.length > 1 ? (
          <DeviceSelect
            devices={camera.devices}
            kind="videoinput"
            value={selected ?? camera.devices[0]?.deviceId}
            onChange={setSelected}
          />
        ) : null}
        <span className="omora-record-hint">
          {ready
            ? error ?? (mode === "review" ? "满意就保存，不满意就重录" : "摄像头只在你点的时候打开")
            : reason}
        </span>
      </div>
    </div>
  );
}

/** video：一条视频。播放走 HTTP 媒体通道，字节不进快照。 */
export function VideoPlayer({ node }: NodeComponentProps): ReactNode {
  const src = prop(node, "src");
  const media = prop(node, "media") ?? "";
  if (src === undefined || src.length === 0) {
    return (
      <span className="omora-video-missing" data-type="video" data-media={media}>
        媒体通道未就绪
      </span>
    );
  }
  return (
    <video
      className="omora-video"
      data-type="video"
      data-media={media}
      src={src}
      controls
      preload="metadata"
      playsInline
    />
  );
}
