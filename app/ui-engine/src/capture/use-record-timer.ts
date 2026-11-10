import { useCallback, useRef, useState } from "react";
import {
  clockSeconds,
  pauseClock,
  resumeClock,
  startClock,
  timeUp,
  type RecordClock,
} from "./capture-rules";

export interface RecordTimer {
  /** 界面上显示的秒数（暂停时冻结） */
  seconds: number;
  /** 到现在为止录了多久；停的时候按它算载荷里的 seconds */
  elapsed: () => number;
  /** 从现在起重置计时；到 limitSeconds 回调一次（0 = 不限） */
  start: (limitSeconds: number, onLimit: () => void) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  /** 现在是不是暂停中（暂停时不该采样） */
  paused: () => boolean;
}

/**
 * 录制计时：暂停冻结、继续接着走、到点回调。
 *
 * 音频和视频共用：两边都是"按时长记、暂停不算"，没理由各写一份。
 */
export function useRecordTimer(): RecordTimer {
  const clock = useRef<RecordClock>(startClock(0));
  const ticker = useRef<number | null>(null);
  const [seconds, setSeconds] = useState(0);

  const stop = useCallback(() => {
    if (ticker.current !== null) {
      window.clearInterval(ticker.current);
      ticker.current = null;
    }
  }, []);

  const start = useCallback(
    (limitSeconds: number, onLimit: () => void) => {
      stop();
      clock.current = startClock(Date.now());
      setSeconds(0);
      ticker.current = window.setInterval(() => {
        const running = clockSeconds(clock.current, Date.now());
        setSeconds(running);
        if (timeUp(limitSeconds, running)) {
          onLimit();
        }
      }, 250);
    },
    [stop],
  );

  const pause = useCallback(() => {
    clock.current = pauseClock(clock.current, Date.now());
  }, []);

  const resume = useCallback(() => {
    clock.current = resumeClock(clock.current, Date.now());
  }, []);

  const elapsed = useCallback(() => clockSeconds(clock.current, Date.now()), []);
  const paused = useCallback(() => clock.current.pausedAt !== null, []);

  return { seconds, start, pause, resume, stop, paused, elapsed };
}
