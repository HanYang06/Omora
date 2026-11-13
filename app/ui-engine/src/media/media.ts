import type { JsonObject } from "../contract/protocol";
import type { MediaData } from "../contract/protocol";

export type Caller = (target: string, method: string, args: JsonObject) => Promise<unknown>;

/**
 * 取一件媒体。参数名是 media_id，必须和 Python 的 `Media.load(media_id)` 对齐：
 * net 插件按关键字转发，名字错了就是 call_failed。
 */
export async function fetchMedia(call: Caller, media: string): Promise<MediaData> {
  const value = await call("media", "load", { media_id: media });
  if (typeof value !== "object" || value === null) {
    throw new Error("media.load 返回的不是对象");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.mime !== "string" || typeof record.data !== "string") {
    throw new Error("media.load 返回缺 mime / data");
  }
  return { mime: record.mime, data: record.data };
}
/** 只用到 fetch 的一小部分，测试里打桩。 */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: Blob },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * 把一段视频传到 HTTP 媒体通道，拿回 media id。
 * 视频不走 base64：base64 会把一份视频涨三分之一，还得整段塞进 JSON。
 */
export async function uploadMedia(fetchImpl: FetchLike, url: string, blob: Blob): Promise<string> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": blob.type || "application/octet-stream" },
    body: blob,
  });
  if (!response.ok) {
    throw new Error(`上传失败（${response.status}）`);
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error("上传返回的不是 JSON");
  }
  if (typeof value !== "object" || value === null) {
    throw new Error("上传返回缺 media_id");
  }
  const mediaId = (value as Record<string, unknown>).media_id;
  if (typeof mediaId !== "string" || mediaId.length === 0) {
    throw new Error("上传返回缺 media_id");
  }
  return mediaId;
}
