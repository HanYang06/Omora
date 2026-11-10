import { describe, expect, it } from "vitest";
import {
  planStop,
  planUpload,
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
