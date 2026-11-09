import { describe, expect, it, vi } from "vitest";
import { fetchMedia } from "./media";
import type { JsonObject } from "./protocol";

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
