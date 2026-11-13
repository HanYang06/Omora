import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Snapshot } from "../../core/types";
import { applySnapshotUpdate } from "./patch";

/** 补丁语义的跨语言钉：同一份 fixture 由 Python 的 diff 与这里的 apply 各跑一遍。 */
interface PatchCase {
  name: string;
  previous: Snapshot;
  current: Snapshot;
  ops: unknown[];
  merged: Snapshot;
}

interface PageChangeCase {
  name: string;
  previous: Snapshot;
  current: Snapshot;
}

interface Fixture {
  cases: PatchCase[];
  page_changes: PageChangeCase[];
}

const FIXTURE_URL = new URL("../../../../sdk/tests/fixtures/patch.json", import.meta.url);
const fixture = JSON.parse(readFileSync(fileURLToPath(FIXTURE_URL), "utf8")) as Fixture;

describe("补丁：与 Python 共用同一份 fixture", () => {
  it.each(fixture.cases)("应用 ops 得到 Python 的合并结果: $name", (item) => {
    const update = applySnapshotUpdate(item.previous, {
      page: item.merged.page,
      base: item.previous.version,
      version: item.merged.version,
      ops: item.ops,
    });

    expect(update.ok, item.name).toBe(true);
    if (update.ok) {
      expect(update.snapshot).toEqual(item.merged);
    }
  });

  it.each(fixture.page_changes)("换页的补丁不被接受: $name", (item) => {
    const update = applySnapshotUpdate(item.previous, {
      page: item.current.page,
      base: item.previous.version,
      version: item.previous.version + 1,
      ops: [],
    });

    expect(update).toEqual({ ok: false, reason: "page" });
  });
});
