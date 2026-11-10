import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { captureErrorReason, captureGate, openMediaStream } from "./devices";
import { DeviceSelect } from "./device-select";
import { planStop } from "./capture-rules";
import { clock, prop, type NodeComponentProps } from "./shared";
import { useMediaDevices } from "./use-devices";

const DEFAULT_SECONDS = 600;

/** node.props 里的数字；不是数字就用兜底值。 */
export function numberProp(node: NodeComponentProps["node"], name: string, fallback: number): number {
  const value = node.props?.[name];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * audio_capture：音频捕捉条。
 *
 * 设备与权限在客户端：没有麦克风就把按钮禁用并写原因；多设备给选择器；
 * 插拔跟着 devicechange 走。录完把 base64 交给 on_submit（音频仍走 v0 的 base64）。
 * 卸载时还在录，也把这段停掉交出去——录制不能因为切走页面就丢了。
 */
export function AudioCapture({ node, onEvent, devices }: NodeComponentProps): ReactNode {
  const handler = prop(node, "on_submit");
  const quality = prop(node, "quality") ?? "high";
  const noiseReduction = node.props?.noise_reduction === true;
  const maxSeconds = numberProp(node, "max_seconds", DEFAULT_SECONDS);
  const { state, refresh } = useMediaDevices(devices);
  const gate = captureGate(state, "audioinput");
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [reason, setReason] = useState<string | undefined>(undefined);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const ticker = useRef<number | null>(null);
  const unmounted = useRef(false);
  const submitted = useRef(false);

  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      if (ticker.current !== null) {
        window.clearInterval(ticker.current);
        ticker.current = null;
      }
      const active = recorder.current;
      if (active !== null && active.state !== "inactive") {
        // 还在录：停下来交给 onstop 提交。这里只动 ref，不碰界面。
        active.stop();
      }
    };
  }, []);

  const stop = useCallback(() => {
    const active = recorder.current;
    if (active !== null && active.state !== "inactive") {
      active.stop();
    }
  }, []);

  const start = useCallback(async () => {
    if (handler === undefined || !gate.enabled) {
      return;
    }
    setReason(undefined);
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
      const stream = await openMediaStream(devices, { audio });
      if (unmounted.current) {
        // 等权限的时候人已经走了：别偷偷录下去，麦克风也别占着
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const options: MediaRecorderOptions =
        quality === "low" ? { audioBitsPerSecond: 64000 } : {};
      const media = new MediaRecorder(stream, options);
      chunks.current = [];
      media.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunks.current.push(event.data);
        }
      };
      media.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (ticker.current !== null) {
          window.clearInterval(ticker.current);
          ticker.current = null;
        }
        const elapsed = (Date.now() - started.current) / 1000;
        const blob = new Blob(chunks.current, { type: media.mimeType || "audio/webm" });
        const plan = planStop({
          submitted: submitted.current,
          hasData: blob.size > 0,
          hasHandler: handler !== undefined && handler.length > 0,
          unmounted: unmounted.current,
        });
        if (plan.updateUi) {
          setRecording(false);
        }
        if (!plan.submit || handler === undefined) {
          return;
        }
        submitted.current = true;
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result ?? "");
          const comma = result.indexOf(",");
          const data = comma >= 0 ? result.slice(comma + 1) : "";
          if (data.length > 0) {
            onEvent?.(handler, {
              audio: data,
              mime: blob.type || "audio/webm",
              seconds: elapsed,
            });
          }
        };
        reader.readAsDataURL(blob);
      };
      recorder.current = media;
      started.current = Date.now();
      setSeconds(0);
      setRecording(true);
      ticker.current = window.setInterval(() => {
        const running = Math.floor((Date.now() - started.current) / 1000);
        setSeconds(running);
        if (running >= maxSeconds) {
          stop();
        }
      }, 250);
      media.start();
      refresh();
    } catch (error) {
      if (unmounted.current) {
        return;
      }
      setReason(captureErrorReason(error, "audioinput"));
    }
  }, [devices, gate.enabled, handler, maxSeconds, noiseReduction, onEvent, quality, refresh, selected, stop]);

  const hint = gate.enabled ? reason ?? (recording ? "再点一下停" : "说出口，比打字快") : gate.reason;

  return (
    <div className="omora-record-bar" data-type="audio_capture" data-gate={gate.enabled ? "on" : "off"}>
      <button
        type="button"
        className={recording ? "omora-record is-recording" : "omora-record"}
        data-handler={handler}
        disabled={!gate.enabled || handler === undefined}
        onClick={() => {
          if (recording) {
            stop();
          } else {
            void start();
          }
        }}
      >
        <span className="omora-record-dot" aria-hidden="true" />
        {recording ? `录音中 ${clock(seconds)}` : "录音"}
      </button>
      {gate.enabled && gate.devices.length > 1 ? (
        <DeviceSelect
          devices={gate.devices}
          kind="audioinput"
          value={selected ?? gate.devices[0]?.deviceId}
          disabled={recording}
          onChange={setSelected}
        />
      ) : null}
      <span className="omora-record-hint">{hint}</span>
    </div>
  );
}
