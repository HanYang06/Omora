import { useRef, useState, type ReactNode } from "react";
import { captureGate } from "../../capture/devices";
import { DeviceSelect } from "../../capture/device-select";
import { IconGlyph } from "../../shell/icons";
import { clock, flag, prop, type NodeComponentProps } from "../../core/shared";
import { useAudioRecorder } from "./use-audio-capture";
import { useMediaDevices } from "../../capture/use-devices";

const DEFAULT_SECONDS = 600;

/** node.props 里的数字；不是数字就用兜底值。 */
export function numberProp(
  node: NodeComponentProps["node"],
  name: string,
  fallback: number,
): number {
  const value = node.props?.[name];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * audio_capture：音频捕捉的主体。
 *
 * 版式：大圆钮 + 计时 + 提示，下面一整条波形，再下面一行动作。
 * 波形与录音本身交给 wavesurfer 的 record 插件（见 useAudioRecorder）。
 */
export function AudioCapture({ node, onEvent, devices }: NodeComponentProps): ReactNode {
  const handler = prop(node, "on_submit");
  const uploadUrl = prop(node, "upload_url");
  const quality = prop(node, "quality") ?? "high";
  const maxSeconds = numberProp(node, "max_seconds", DEFAULT_SECONDS);
  const autostart = flag(node, "autostart");
  const pausable = flag(node, "pausable");
  const { state, refresh } = useMediaDevices(devices);
  const gate = captureGate(state, "audioinput");
  const ready = gate.enabled && uploadUrl !== undefined && handler !== undefined;
  const blocked = gate.enabled ? "媒体通道未就绪" : gate.reason;
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const stage = useRef<HTMLDivElement | null>(null);
  const recorder = useAudioRecorder({
    container: stage,
    ready,
    autostart,
    maxSeconds,
    quality,
    deviceId: selected,
    handler,
    uploadUrl,
    onEvent,
  });

  const active = recorder.phase === "recording" || recorder.phase === "paused";
  const idle = recorder.phase === "idle";
  const hint = !ready
    ? blocked
    : (recorder.error ??
      (recorder.phase === "recording"
        ? "点一下停"
        : recorder.phase === "paused"
          ? "已暂停，可以继续或直接停"
          : recorder.phase === "uploading"
            ? "上传中…"
            : "点一下开始，按住空格说"));

  return (
    <div
      className="omora-record-bar"
      data-type="audio_capture"
      data-gate={ready ? "on" : "off"}
      data-phase={recorder.phase}
    >
      <button
        type="button"
        className="omora-talk"
        data-phase={recorder.phase}
        data-handler={handler}
        aria-label={idle ? "开始录音" : "停止录音"}
        disabled={!ready || recorder.phase === "uploading" || recorder.phase === "failed"}
        onClick={() => {
          refresh();
          if (idle) {
            void recorder.start();
          } else {
            recorder.stop();
          }
        }}
      >
        {idle ? <IconGlyph name="mic" size={28} /> : <span className="omora-talk-stop" />}
      </button>
      {idle ? null : (
        <span className="omora-record-clock">
          {clock(recorder.seconds)}
          {recorder.phase === "paused" ? <small>已暂停</small> : null}
        </span>
      )}
      <span className="omora-record-hint">{hint}</span>
      <div className="omora-record-actions">
        {pausable && recorder.phase === "recording" ? (
          <button type="button" className="omora-button" onClick={recorder.pause}>
            暂停
          </button>
        ) : null}
        {pausable && recorder.phase === "paused" ? (
          <button type="button" className="omora-button" onClick={recorder.resume}>
            继续
          </button>
        ) : null}
        {recorder.phase === "failed" ? (
          <button type="button" className="omora-button" onClick={recorder.retry}>
            重试
          </button>
        ) : null}
        {ready && gate.devices.length > 1 && !active ? (
          <DeviceSelect
            devices={gate.devices}
            kind="audioinput"
            value={selected ?? gate.devices[0]?.deviceId}
            disabled={recorder.phase !== "idle"}
            onChange={setSelected}
          />
        ) : null}
      </div>
      <div className="omora-wave" ref={stage} data-live={active ? "on" : "off"} />
    </div>
  );
}
