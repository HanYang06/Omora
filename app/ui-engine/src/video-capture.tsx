import { useState, type ReactNode } from "react";
import { captureGate } from "./devices";
import { DeviceSelect } from "./device-select";
import { LiveVideo } from "./live-video";
import { numberProp } from "./audio-capture";
import { clock, flag, prop, type NodeComponentProps } from "./shared";
import { useMediaDevices } from "./use-devices";
import { useVideoRecorder } from "./use-video-capture";
import { DEFAULT_SECONDS } from "./video-quality";

/**
 * video_capture：视频捕捉条。
 *
 * 设备门禁与实时预览在本机；录制机制在 useVideoRecorder。停下来就上传 HTTP
 * 媒体通道，成功即存；上传失败给原因 + 重试。max_seconds = 0 表示不限时长，
 * pausable 给出暂停 / 继续，暂停的时间不算进时长。
 */
export function VideoCapture({ node, onEvent, devices }: NodeComponentProps): ReactNode {
  const handler = prop(node, "on_submit");
  const uploadUrl = prop(node, "upload_url");
  const quality = prop(node, "quality") ?? "720p";
  const maxSeconds = numberProp(node, "max_seconds", DEFAULT_SECONDS);
  const pausable = flag(node, "pausable");
  const { state, refresh } = useMediaDevices(devices);
  const camera = captureGate(state, "videoinput");
  const ready = camera.enabled && uploadUrl !== undefined && handler !== undefined;
  const reason = camera.enabled ? "媒体通道未就绪" : camera.reason;
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const recorder = useVideoRecorder({
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
  });
  const mode = recorder.mode;
  const hint = ready
    ? recorder.error ??
      (mode === "uploading"
        ? "上传中…"
        : mode === "paused"
          ? "已暂停"
          : "摄像头只在你点的时候打开")
    : reason;

  return (
    <div
      className="omora-video-bar"
      data-type="video_capture"
      data-gate={ready ? "on" : "off"}
      data-mode={mode}
    >
      {mode === "recording" || mode === "paused" ? (
        <LiveVideo stream={recorder.stream} />
      ) : null}
      {recorder.previewUrl !== undefined ? (
        <video className="omora-video" src={recorder.previewUrl} controls playsInline />
      ) : null}
      <div className="omora-video-actions">
        {mode === "idle" ? (
          <button
            type="button"
            className="omora-record"
            data-handler={handler}
            disabled={!ready}
            onClick={recorder.start}
          >
            <span className="omora-record-dot" aria-hidden="true" />
            录视频
          </button>
        ) : null}
        {mode === "recording" || mode === "paused" ? (
          <button type="button" className="omora-record is-recording" onClick={recorder.stop}>
            {clock(recorder.seconds)} 停止
          </button>
        ) : null}
        {pausable && mode === "recording" ? (
          <button
            type="button"
            className="omora-record omora-record--quiet"
            onClick={recorder.pause}
          >
            暂停
          </button>
        ) : null}
        {pausable && mode === "paused" ? (
          <button
            type="button"
            className="omora-record omora-record--quiet"
            onClick={recorder.resume}
          >
            继续
          </button>
        ) : null}
        {mode === "failed" ? (
          <button type="button" className="omora-record" onClick={recorder.retry}>
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
