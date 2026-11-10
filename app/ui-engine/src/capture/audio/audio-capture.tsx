import { useState, type ReactNode } from "react";
import { captureGate } from "../devices";
import { DeviceSelect } from "../device-select";
import { PeakBars } from "../../render/waveform";
import { clock, flag, prop, type NodeComponentProps } from "../../core/shared";
import { useAudioRecorder } from "./use-audio-capture";
import { useMediaDevices } from "../use-devices";

const DEFAULT_SECONDS = 600;

/** 实时电平只画最近这么多根：300 根塞不进一条捕捉条，静态波形才用全量。 */
const LIVE_BARS = 60;

/** node.props 里的数字；不是数字就用兜底值。 */
export function numberProp(node: NodeComponentProps["node"], name: string, fallback: number): number {
  const value = node.props?.[name];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * audio_capture：音频捕捉的主体。
 *
 * 设备门禁、多设备选择、实时电平、暂停都在本机；录制机制在 useAudioRecorder，
 * 这里只管长什么样。max_seconds = 0 表示不限时长，autostart 一挂上就录。
 */
export function AudioCapture({ node, onEvent, devices }: NodeComponentProps): ReactNode {
  const handler = prop(node, "on_submit");
  const uploadUrl = prop(node, "upload_url");
  const quality = prop(node, "quality") ?? "high";
  const noiseReduction = node.props?.noise_reduction === true;
  const maxSeconds = numberProp(node, "max_seconds", DEFAULT_SECONDS);
  const autostart = flag(node, "autostart");
  const pausable = flag(node, "pausable");
  const { state, refresh } = useMediaDevices(devices);
  const gate = captureGate(state, "audioinput");
  const ready = gate.enabled && uploadUrl !== undefined && handler !== undefined;
  const blocked = gate.enabled ? "媒体通道未就绪" : gate.reason;
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const recorder = useAudioRecorder({
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
  });
  const active = recorder.phase === "recording" || recorder.phase === "paused";
  const hint = !ready
    ? blocked
    : recorder.error ??
      (recorder.phase === "recording"
        ? "再点一下停"
        : recorder.phase === "paused"
          ? "已暂停"
          : recorder.phase === "uploading"
            ? "上传中…"
            : "说出口，比打字快");

  return (
    <div
      className="omora-record-bar"
      data-type="audio_capture"
      data-gate={ready ? "on" : "off"}
      data-phase={recorder.phase}
    >
      <button
        type="button"
        className={active ? "omora-record is-recording" : "omora-record"}
        data-handler={handler}
        disabled={!ready || recorder.phase === "uploading" || recorder.phase === "failed"}
        onClick={() => {
          if (active) {
            recorder.stop();
          } else {
            recorder.start();
          }
        }}
      >
        <span className="omora-record-dot" aria-hidden="true" />
        {recorder.phase === "recording"
          ? `录音中 ${clock(recorder.seconds)}`
          : recorder.phase === "paused"
            ? `已暂停 ${clock(recorder.seconds)}`
            : "录音"}
      </button>
      {pausable && recorder.phase === "recording" ? (
        <button type="button" className="omora-record omora-record--quiet" onClick={recorder.pause}>
          暂停
        </button>
      ) : null}
      {pausable && recorder.phase === "paused" ? (
        <button type="button" className="omora-record omora-record--quiet" onClick={recorder.resume}>
          继续
        </button>
      ) : null}
      {recorder.phase === "failed" ? (
        <button type="button" className="omora-record" onClick={recorder.retry}>
          重试
        </button>
      ) : null}
      {active ? <PeakBars peaks={recorder.live.slice(-LIVE_BARS)} /> : null}
      {ready && gate.devices.length > 1 && !active ? (
        <DeviceSelect
          devices={gate.devices}
          kind="audioinput"
          value={selected ?? gate.devices[0]?.deviceId}
          disabled={recorder.phase !== "idle"}
          onChange={setSelected}
        />
      ) : null}
      <span className="omora-record-hint">{hint}</span>
    </div>
  );
}
