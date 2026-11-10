/**
 * 捕捉条的可判定逻辑：停止之后要不要提交、上传失败停在哪个态。
 *
 * 这两件事都发生在事件回调里，其中"卸载时"那条更要等组件已经没了才跑完——
 * 组件不在就没法渲染、断言，行为就钉不住。判定搬到这里，纯函数就能测。
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
