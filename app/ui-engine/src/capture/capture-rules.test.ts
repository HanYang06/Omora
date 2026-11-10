import { describe, expect, it } from "vitest";
import {
  MAX_PEAKS,
  clockSeconds,
  pauseClock,
  planStop,
  planUpload,
  pushPeak,
  resumeClock,
  rmsToPeak,
  startClock,
  timeUp,
  uploadFailureReason,
  type StopFacts,
} from "./capture-rules";

/** 一段录完的音频：有字节、有回调、组件还在、还没交过。 */
function stopFacts(overrides: Partial<StopFacts> = {}): StopFacts {
  return { submitted: false, hasData: true, hasHandler: true, unmounted: false, ...overrides };
}

describe("停止之后要不要提交", () => {
  it("组件还在时手动停止：交出去，并回到停止态", () => {
    expect(planStop(stopFacts())).toEqual({ submit: true, updateUi: true });
  });

  it("卸载时还在录：这段照样交出去，但不回写界面", () => {
    expect(planStop(stopFacts({ unmounted: true }))).toEqual({
      submit: true,
      updateUi: false,
    });
  });

  it("已经交过一次：不再交（同一次停止只走一条路）", () => {
    expect(planStop(stopFacts({ submitted: true }))).toEqual({ submit: false, updateUi: false });
  });

  it("没录到字节：不交，界面照常回到停止态", () => {
    expect(planStop(stopFacts({ hasData: false }))).toEqual({ submit: false, updateUi: true });
  });

  it("没有 on_submit：没地方交，界面照样回到停止态", () => {
    expect(planStop(stopFacts({ hasHandler: false }))).toEqual({
      submit: false,
      updateUi: true,
    });
  });
});

describe("上传完成后事件与界面的去向", () => {
  it("成功、组件还在：交事件，回到空闲，字节不再留在内存里", () => {
    expect(planUpload({ ok: true, unmounted: false })).toEqual({
      submit: true,
      phase: "idle",
      reason: "",
      keepBlob: false,
      updateUi: true,
      log: false,
    });
  });

  it("成功但组件已经卸载：事件照样交出去，只是不碰界面", () => {
    const plan = planUpload({ ok: true, unmounted: true });

    expect(plan.submit).toBe(true);
    expect(plan.updateUi).toBe(false);
  });

  it("失败、组件还在：不提交，停在失败态，留着字节等重试", () => {
    expect(planUpload({ ok: false, reason: "上传失败（500）", unmounted: false })).toEqual({
      submit: false,
      phase: "failed",
      reason: "上传失败（500）",
      keepBlob: true,
      updateUi: true,
      log: false,
    });
  });

  it("失败且组件已卸载：不提交、不碰界面，只记日志", () => {
    const plan = planUpload({ ok: false, reason: "上传失败（500）", unmounted: true });

    expect(plan.submit).toBe(false);
    expect(plan.updateUi).toBe(false);
    expect(plan.log).toBe(true);
    expect(plan.keepBlob).toBe(true);
  });

  it("失败没带原因：界面也得有话说，不能是空串", () => {
    expect(planUpload({ ok: false, unmounted: false }).reason).toBe("上传失败");
  });
});

describe("上传错误 → 界面上的原因", () => {
  it("Error 用它自己的话", () => {
    expect(uploadFailureReason(new Error("上传失败（500）"))).toBe("上传失败（500）");
  });

  it("不是 Error、或者是空消息：给一句兜底，别把 [object Object] 写进界面", () => {
    expect(uploadFailureReason({ status: 500 })).toBe("上传失败");
    expect(uploadFailureReason(undefined)).toBe("上传失败");
    expect(uploadFailureReason(new Error(""))).toBe("上传失败");
  });
});
describe("录制中的波形峰值", () => {
  it("新柱子接在末尾，不改变已经采到的顺序", () => {
    expect(pushPeak([10, 20], 30)).toEqual([10, 20, 30]);
  });

  it("越界和小数先夹回 0–100 的整数，再进序列", () => {
    expect(pushPeak([], 150)).toEqual([100]);
    expect(pushPeak([], -3)).toEqual([0]);
    expect(pushPeak([], 42.6)).toEqual([43]);
  });

  it("满 300 根之后开始压缩，之后录多久都不超过 300 根", () => {
    let peaks: number[] = [];
    for (let index = 0; index < MAX_PEAKS; index += 1) {
      peaks = pushPeak(peaks, 50);
    }
    expect(peaks).toHaveLength(MAX_PEAKS);

    peaks = pushPeak(peaks, 50);
    expect(peaks.length).toBeLessThan(MAX_PEAKS);

    for (let index = 0; index < 5000; index += 1) {
      peaks = pushPeak(peaks, 50);
    }
    expect(peaks.length).toBeLessThanOrEqual(MAX_PEAKS);
    expect(peaks.length).toBeGreaterThan(0);
  });

  it("压缩取一段里的最大值：一声重音不会被平均抹平", () => {
    const peaks = Array.from({ length: MAX_PEAKS }, () => 0);
    peaks[MAX_PEAKS - 1] = 100;

    const squeezed = pushPeak(peaks, 0);

    expect(squeezed.length).toBeLessThan(MAX_PEAKS);
    expect(Math.max(...squeezed)).toBe(100);
  });

  it("RMS 映射：静音贴底、满幅到顶、常用音量被抬起来", () => {
    expect(rmsToPeak(0)).toBe(0);
    expect(rmsToPeak(1)).toBe(100);
    expect(rmsToPeak(0.25)).toBe(50);
    expect(rmsToPeak(2)).toBe(100);
    expect(rmsToPeak(-1)).toBe(0);
    // 小声说话的 RMS 大约 0.04：线性映射只剩 4，平方根映射还能看见
    expect(rmsToPeak(0.04)).toBeGreaterThan(10);
  });
});

describe("暂停与计时", () => {
  it("没暂停时按真实流逝走", () => {
    expect(clockSeconds(startClock(1000), 6000)).toBe(5);
  });

  it("暂停时计时冻结，等多久都不涨", () => {
    const paused = pauseClock(startClock(0), 5000);

    expect(clockSeconds(paused, 9000)).toBe(5);
    expect(clockSeconds(paused, 600000)).toBe(5);
  });

  it("继续之后暂停的那段不算进时长", () => {
    const resumed = resumeClock(pauseClock(startClock(0), 5000), 12000);

    expect(clockSeconds(resumed, 14000)).toBe(7);
  });

  it("连点两次暂停不会把时间吞两次", () => {
    const twice = pauseClock(pauseClock(startClock(0), 5000), 8000);

    expect(clockSeconds(twice, 9000)).toBe(5);
  });

  it("没暂停时点继续不改变计时", () => {
    const clock = startClock(0);

    expect(clockSeconds(resumeClock(clock, 3000), 4000)).toBe(4);
  });

  it("系统时钟倒着走也不会给出负时长", () => {
    expect(clockSeconds(startClock(10000), 5000)).toBe(0);
  });
});

describe("时长上限", () => {
  it("max_seconds = 0 表示不限时长，录多久都不自动停", () => {
    expect(timeUp(0, 999999)).toBe(false);
  });

  it("负数也按不限处理", () => {
    expect(timeUp(-1, 60)).toBe(false);
  });

  it("到点自动停，差一点不算停", () => {
    expect(timeUp(30, 29.9)).toBe(false);
    expect(timeUp(30, 30)).toBe(true);
    expect(timeUp(30, 31)).toBe(true);
  });
});
