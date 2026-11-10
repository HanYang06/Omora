import { describe, expect, it, vi } from "vitest";
import { fetchMedia, uploadMedia, type FetchLike } from "./media";
import type { JsonObject } from "../core/protocol";

describe("fetchMedia", () => {
  it("调 media.load 时用 media_id，并把 mime / data 取回来", async () => {
    const call = vi.fn(
      async (_target: string, _method: string, _args: JsonObject) => ({
        mime: "audio/webm",
        data: "aGVsbG8=",
      }),
    );

    const result = await fetchMedia(call, "abc");

    expect(call).toHaveBeenCalledWith("media", "load", { media_id: "abc" });
    expect(result).toEqual({ mime: "audio/webm", data: "aGVsbG8=" });
  });

  it("返回值缺 mime / data 就报错", async () => {
    const call = vi.fn(async () => ({ mime: 1 }));

    await expect(fetchMedia(call, "abc")).rejects.toThrow("缺 mime / data");
  });
});
describe("uploadMedia", () => {
  it("把 blob POST 到媒体通道，用 blob 的 mime 当 Content-Type", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ media_id: "abc" }),
    }));
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "video/webm" });

    const mediaId = await uploadMedia(fetchImpl, "http://127.0.0.1:8766/media", blob);

    expect(mediaId).toBe("abc");
    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:8766/media", {
      method: "POST",
      headers: { "Content-Type": "video/webm" },
      body: blob,
    });
  });

  it("非 2xx 抛错并带上状态码", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ({
      ok: false,
      status: 413,
      json: async () => ({}),
    }));

    await expect(uploadMedia(fetchImpl, "http://127.0.0.1:8766/media", new Blob([]))).rejects.toThrow(
      "上传失败（413）",
    );
  });

  it("返回里没有 media_id 就报错", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ({
      ok: true,
      status: 201,
      json: async () => ({}),
    }));

    await expect(uploadMedia(fetchImpl, "u", new Blob([]))).rejects.toThrow("缺 media_id");
  });
});
