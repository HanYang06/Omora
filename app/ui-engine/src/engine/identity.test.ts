import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { chainAddr, nodeIdentity, shortCode } from "./identity";

const FIXTURE_PATH = fileURLToPath(
  new URL("../../../sdk/tests/fixtures/identity.json", import.meta.url),
);

interface Fixture {
  codes: { seed: string; code: string }[];
  addresses: { parent: string | null; code: string; addr: string }[];
}

function fixture(): Fixture {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;
}

describe("identity：code / addr 派生", () => {
  it("shortCode 与 Python 侧 golden fixture 一致", async () => {
    for (const item of fixture().codes) {
      await expect(shortCode(item.seed)).resolves.toBe(item.code);
    }
  });

  it("shortCode 固定 16 字符且同种子稳定", async () => {
    const code = await shortCode("page.ideas.content.main.feed[42]");
    expect(code).toHaveLength(16);
    await expect(shortCode("page.ideas.content.main.feed[42]")).resolves.toBe(code);
  });

  it("chainAddr 与 Python 侧 golden fixture 一致", async () => {
    for (const item of fixture().addresses) {
      await expect(chainAddr(item.parent, item.code)).resolves.toBe(item.addr);
    }
  });

  it("内容变不改 code/addr；同父重复派生结果相同", async () => {
    const before = await nodeIdentity("zgufckla2amnbrel", "page.ideas");
    const after = await nodeIdentity("zgufckla2amnbrel", "page.ideas");
    expect(after).toEqual(before);
  });

  it("兄弟插入不改已存在节点的 code", async () => {
    const before = await shortCode("page.ideas.content.main.feed[42]");
    await shortCode("page.ideas.content.main.feed[41]");
    await expect(shortCode("page.ideas.content.main.feed[42]")).resolves.toBe(before);
  });

  it("move 保留 code、改变 addr", async () => {
    const code = await shortCode("page.ideas.content.main.feed[42]");
    const oldAddr = await chainAddr("feed-parent", code);
    const newAddr = await chainAddr("rail-parent", code);
    expect(oldAddr).not.toBe(newAddr);
  });

  it("空种子被拒绝", async () => {
    await expect(shortCode("")).rejects.toThrow("seed");
  });
});
