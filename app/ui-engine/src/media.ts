import type { JsonObject } from "./protocol";
import type { MediaData } from "./types";

export type Caller = (
  target: string,
  method: string,
  args: JsonObject,
) => Promise<unknown>;

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
