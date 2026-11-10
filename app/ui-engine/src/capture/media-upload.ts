import { planUpload, uploadFailureReason, type UploadPlan } from "./capture-rules";
import { uploadMedia } from "../media/media";

export interface UploadAttempt {
  /** 上传成功才有 */
  mediaId?: string;
  /** 事件与界面该往哪走 */
  plan: UploadPlan;
}

/**
 * 把一段字节交给 HTTP 媒体通道。
 *
 * 成功给 media id；失败不给——失败不提交，字节由调用方留着等重试。
 * 音频与视频共用同一条通道，只有 mime 与载荷字段不同。
 */
export async function uploadRecorded(
  url: string | undefined,
  blob: Blob,
  unmounted: boolean,
): Promise<UploadAttempt> {
  let mediaId: string | undefined;
  let failure: unknown;
  try {
    if (url === undefined || url.length === 0) {
      throw new Error("媒体通道未就绪");
    }
    mediaId = await uploadMedia((target, init) => fetch(target, init), url, blob);
  } catch (upstream) {
    failure = upstream;
  }
  return {
    mediaId,
    plan: planUpload({
      ok: mediaId !== undefined,
      reason: uploadFailureReason(failure),
      unmounted,
    }),
  };
}
