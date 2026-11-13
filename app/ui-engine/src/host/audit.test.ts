import { describe, expect, it } from "vitest";
import { AuditLog } from "./audit";

describe("AuditLog：seq、容量、副本与清空", () => {
  it("seq 从 1 起单调自增，字段原样保留，entries 按旧 → 新", () => {
    const log = new AuditLog();
    log.record({ kind: "apply", changed: 3 });
    log.record({
      kind: "deny",
      code: "E-PERMISSION",
      owner: "ideas",
      slot: "page.ideas",
      message: "没有 update 能力",
      changed: 0,
    });
    log.record({ kind: "diagnostic", code: "E-TEMPLATE", message: "坏条目" });

    expect(log.entries()).toEqual([
      { seq: 1, kind: "apply", changed: 3 },
      {
        seq: 2,
        kind: "deny",
        code: "E-PERMISSION",
        owner: "ideas",
        slot: "page.ideas",
        message: "没有 update 能力",
        changed: 0,
      },
      { seq: 3, kind: "diagnostic", code: "E-TEMPLATE", message: "坏条目" },
    ]);
    expect(log.size).toBe(3);
  });

  it("超过容量丢最旧，seq 不回头", () => {
    const log = new AuditLog(3);
    for (let index = 1; index <= 5; index += 1) {
      log.record({ kind: "reject", message: "第 " + index + " 条" });
    }

    expect(log.entries().map((entry) => [entry.seq, entry.message])).toEqual([
      [3, "第 3 条"],
      [4, "第 4 条"],
      [5, "第 5 条"],
    ]);
    expect(log.size).toBe(3);
  });

  it("默认容量 200：第 201 条起丢最旧", () => {
    const log = new AuditLog();
    for (let index = 0; index < 205; index += 1) {
      log.record({ kind: "apply" });
    }

    const entries = log.entries();
    expect(entries).toHaveLength(200);
    expect(entries[0]?.seq).toBe(6);
    expect(entries[199]?.seq).toBe(205);
  });

  it("entries 返回副本：改返回值不影响日志", () => {
    const log = new AuditLog();
    log.record({ kind: "apply", changed: 1 });

    const snapshot = log.entries();
    snapshot[0]!.kind = "deny";
    snapshot.push({ seq: 99, kind: "reject" });

    expect(log.entries()).toEqual([{ seq: 1, kind: "apply", changed: 1 }]);
    expect(log.size).toBe(1);
  });

  it("clear 只清条目、不重置 seq", () => {
    const log = new AuditLog(2);
    log.record({ kind: "apply" });
    log.record({ kind: "reject" });

    log.clear();

    expect(log.entries()).toEqual([]);
    expect(log.size).toBe(0);
    log.record({ kind: "apply" });
    expect(log.entries()).toEqual([{ seq: 3, kind: "apply" }]);
  });

  it("容量必须是正整数：0 / 负数 / 小数抛 RangeError", () => {
    expect(() => new AuditLog(0)).toThrow(RangeError);
    expect(() => new AuditLog(-1)).toThrow(RangeError);
    expect(() => new AuditLog(2.5)).toThrow(RangeError);
  });
});
