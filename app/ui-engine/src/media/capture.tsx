import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { clock, prop, type NodeComponentProps } from "../core/shared";

let currentAudio: HTMLAudioElement | null = null;

/** recorder：点一下录音，再点一下停；录完把 base64 交给 on_submit。 */
export function Recorder({ node, onEvent }: NodeComponentProps): ReactNode {
  const handler = prop(node, "on_submit");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const timer = useRef<number | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
      if (timer.current !== null) {
        window.clearInterval(timer.current);
      }
      const active = recorder.current;
      if (active !== null && active.state !== "inactive") {
        active.stop();
      }
    };
  }, []);

  const start = useCallback(async () => {
    if (handler === undefined) {
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const media = new MediaRecorder(stream);
      chunks.current = [];
      media.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunks.current.push(event.data);
        }
      };
      media.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (timer.current !== null) {
          window.clearInterval(timer.current);
          timer.current = null;
        }
        setRecording(false);
        if (cancelled.current) {
          return;
        }
        const elapsed = (Date.now() - started.current) / 1000;
        const blob = new Blob(chunks.current, { type: media.mimeType || "audio/webm" });
        const reader = new FileReader();
        reader.onload = () => {
          const result = typeof reader.result === "string" ? reader.result : "";
          const comma = result.indexOf(",");
          const data = comma >= 0 ? result.slice(comma + 1) : "";
          if (data.length > 0 && handler.length > 0) {
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
      timer.current = window.setInterval(() => {
        setSeconds(Math.floor((Date.now() - started.current) / 1000));
      }, 250);
      media.start();
    } catch (error) {
      console.error("[omora] 无法开始录音:", error);
    }
  }, [handler, onEvent]);

  const stop = useCallback(() => {
    const active = recorder.current;
    if (active !== null && active.state !== "inactive") {
      active.stop();
    }
  }, []);

  return (
    <div className="omora-recorder" data-type="recorder">
      <button
        type="button"
        className={recording ? "omora-record is-recording" : "omora-record"}
        data-handler={handler}
        disabled={handler === undefined}
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
      <span className="omora-record-hint">{recording ? "再点一下停" : "说出口，比打字快"}</span>
    </div>
  );
}

/** audio：一条音频；点播放时按需从 media 服务取。 */
export function Audio({ node, loadMedia }: NodeComponentProps): ReactNode {
  const media = prop(node, "media");
  const ready = media !== undefined && media.length > 0 && loadMedia !== undefined;

  return (
    <button
      type="button"
      className="omora-audio"
      data-type="audio"
      data-handler={media}
      aria-label="播放"
      disabled={!ready}
      onClick={() => {
        if (media === undefined || loadMedia === undefined) {
          return;
        }
        void loadMedia(media)
          .then(({ mime, data }) => {
            currentAudio?.pause();
            const audio = new window.Audio(`data:${mime};base64,${data}`);
            currentAudio = audio;
            void audio.play().catch((error: unknown) => console.error("[omora] 播放失败:", error));
          })
          .catch((error: unknown) => console.error("[omora] 取媒体失败:", error));
      }}
    >
      ▶
    </button>
  );
}
