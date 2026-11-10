/**
 * 捕捉条的纯规则：停止 / 上传的去向、波形峰值、计时与时限。
 *
 * 这些都发生在事件回调里，有些要等组件已经没了才跑完——组件不在就没法渲染、断言，
 * 行为就钉不住。规则搬到这里，纯函数就能测。
 */

/** 一段录制停下来的那一刻知道的事。 */
export interface StopFacts {
  /** 这段已经交出去过（重复的 stop / 卸载） */
  submitted: boolean;
  /** 录到了内容 */
  hasData: boolean;
  /** 有 on_submit 可以交 */
  hasHandler: boolean;
  /** 组件已经卸载：不能再 setState */
  unmounted: boolean;
}

export interface StopPlan {
  /** 把这段交给 on_submit */
  submit: boolean;
  /** 回写界面（回到停止态） */
  updateUi: boolean;
}

/**
 * 停止之后怎么办。
 *
 * 卸载不吞录制：组件没了照样提交，只是不碰界面——卸载之后再 setState 没有意义。
 * 只交一次：已经交过就什么都不做。
 */
export function planStop(facts: StopFacts): StopPlan {
  if (facts.submitted) {
    return { submit: false, updateUi: false };
  }
  return {
    submit: facts.hasData && facts.hasHandler,
    updateUi: !facts.unmounted,
  };
}

/** 一次上传的结局。 */
export interface UploadFacts {
  ok: boolean;
  /** 失败原因；成功时不给 */
  reason?: string;
  /** 组件已经卸载 */
  unmounted: boolean;
}

export interface UploadPlan {
  /** 把 media id 交给 on_submit */
  submit: boolean;
  /** 界面停在哪个态 */
  phase: "idle" | "failed";
  /** 给人看的原因；成功时是空串 */
  reason: string;
  /** 留着 blob 等重试（失败时） */
  keepBlob: boolean;
  /** 能不能回写界面 */
  updateUi: boolean;
  /** 组件没了：这版没有重试队列，只能记日志 */
  log: boolean;
}

/**
 * 上传完之后事件与界面的去向。
 *
 * 录了即存：成功就交，组件没了也交——已经录到的内容不能因为卸载丢掉。
 * 失败不交：blob 留在原地等重试；组件已经没了就只剩一条日志。
 */
export function planUpload(facts: UploadFacts): UploadPlan {
  if (facts.ok) {
    return {
      submit: true,
      phase: "idle",
      reason: "",
      keepBlob: false,
      updateUi: !facts.unmounted,
      log: false,
    };
  }
  return {
    submit: false,
    phase: "failed",
    reason: uploadFailureReason(facts.reason),
    keepBlob: true,
    updateUi: !facts.unmounted,
    log: facts.unmounted,
  };
}

/** 上传抛的错 → 一句放在界面上的原因。 */
export function uploadFailureReason(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.length > 0) {
    return error;
  }
  return "上传失败";
}

/** 波形最多留多少根柱子。 */
export const MAX_PEAKS = 300;

/** 实时电平的采样间隔：100ms 一根柱子。 */
export const PEAK_INTERVAL_MS = 100;

/** 采样值 → 柱高：0–1 的 RMS 压到 0–100。 */
export function clampPeak(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * RMS → 柱高。
 *
 * 用平方根而不是线性：说话的正常音量 RMS 只有 0.05–0.2，线性映射后柱子几乎贴地，
 * 屏幕上看起来像没在录。平方根把这段常用区间抬起来，又保留 0 与 1 两个端点。
 */
export function rmsToPeak(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) {
    return 0;
  }
  return clampPeak(Math.sqrt(Math.min(rms, 1)) * 100);
}

/**
 * 把一根新柱子并进序列，最多留 `max` 根。
 *
 * 超过上限时把相邻两根合成一根、取较大的那个：不平均，因为平均会把一声重音抹平。
 * 每合并一轮，一根柱子覆盖的时间翻倍——长录音柱子数不会随分钟数无限涨。
 */
export function pushPeak(
  peaks: readonly number[],
  sample: number,
  max: number = MAX_PEAKS,
): number[] {
  const limit = Math.max(1, Math.floor(max));
  const next = [...peaks.map(clampPeak), clampPeak(sample)];
  while (next.length > limit) {
    const merged: number[] = [];
    for (let index = 0; index < next.length; index += 2) {
      merged.push(Math.max(next[index] ?? 0, next[index + 1] ?? 0));
    }
    next.splice(0, next.length, ...merged);
  }
  return next;
}

/** 一段录制的计时：暂停的那段时间不算。毫秒时间戳。 */
export interface RecordClock {
  /** 真正开始录的时刻 */
  startedAt: number;
  /** 之前暂停累计了多久 */
  pausedMs: number;
  /** 正在暂停：暂停开始的时刻；没暂停就是 null */
  pausedAt: number | null;
}

export function startClock(now: number): RecordClock {
  return { startedAt: now, pausedMs: 0, pausedAt: null };
}

/** 暂停；已经在暂停中就什么都不做（重复点暂停不该把时间吞掉）。 */
export function pauseClock(clock: RecordClock, now: number): RecordClock {
  if (clock.pausedAt !== null) {
    return clock;
  }
  return { ...clock, pausedAt: now };
}

/** 继续；没在暂停中就什么都不做，暂停的那段并进累计。 */
export function resumeClock(clock: RecordClock, now: number): RecordClock {
  if (clock.pausedAt === null) {
    return clock;
  }
  return {
    startedAt: clock.startedAt,
    pausedMs: clock.pausedMs + Math.max(0, now - clock.pausedAt),
    pausedAt: null,
  };
}

/** 已经录了多久（秒）；暂停中返回冻结的值。 */
export function clockSeconds(clock: RecordClock, now: number): number {
  const paused =
    clock.pausedMs + (clock.pausedAt === null ? 0 : Math.max(0, now - clock.pausedAt));
  return Math.max(0, (now - clock.startedAt - paused) / 1000);
}

/**
 * 到点该不该自动停。
 *
 * `max_seconds = 0`（或负数、非有限）表示不限时长：一直录到用户停。
 */
export function timeUp(maxSeconds: number, seconds: number): boolean {
  if (!Number.isFinite(maxSeconds) || maxSeconds <= 0) {
    return false;
  }
  return seconds >= maxSeconds;
}
