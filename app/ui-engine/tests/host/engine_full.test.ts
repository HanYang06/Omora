/**
 * 全量替换的权限闸门：applyFullWithPermission 的行为 + EngineRuntime.applyFull 的接线。
 *
 * 钉住四件事：
 * - 拒绝落在**当前**根 slot 的 replace 上（诊断带现场 owner / slot）；
 * - 形状 / 版本错误优先于权限，不能被用来探测权限；
 * - 新文档内部的 grant 不参与判定（不能自我授权）；
 * - 拒绝时整份会话不变、指标 / 审计记为拒绝、不通知监听者。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Requester } from "../../src/contract/policy";
import { createEngine, type EngineApplyResult, type EngineRuntime } from "../../src/host/engine";
import { createSession, type SessionState } from "../../src/engine/document/session";
import { applyFullWithPermission } from "../../src/host/engine_full";

/** 共享 fixture（不许改）：version 3 的整份 Slot 文档，根是 owner=dendro 的窗口。 */
const DOCUMENT_FIXTURE_PATH = fileURLToPath(
  new URL("../../../sdk/tests/fixtures/document.json", import.meta.url),
);

function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("应该是对象: " + JSON.stringify(value));
  }
  return value as Record<string, unknown>;
}

function readFixture(): Record<string, unknown> {
  return recordOf(JSON.parse(readFileSync(DOCUMENT_FIXTURE_PATH, "utf8")));
}

function sessionOf(value: unknown): SessionState {
  const created = createSession(value);
  if (!created.ok) {
    throw new Error("测试文档应能建会话: " + JSON.stringify(created.diagnostics));
  }
  return created.session;
}

function engineOf(value: unknown, requester?: Requester): EngineRuntime {
  const created = createEngine(value, requester === undefined ? {} : { requester });
  if (!created.ok) {
    throw new Error("测试文档应能建引擎: " + JSON.stringify(created.diagnostics));
  }
  return created.engine;
}

function applied(result: EngineApplyResult) {
  if (!result.ok) {
    throw new Error("apply 应成功: " + JSON.stringify(result.diagnostics));
  }
  return result;
}

function failed(result: EngineApplyResult) {
  if (result.ok) {
    throw new Error("apply 应失败");
  }
  return result.diagnostics;
}

/** 全量替换用的另一份文档：树 / pages / active / data 全不同。 */
function replacementDocument(version: number): Record<string, unknown> {
  return {
    schema: "dendro.ui/1",
    document: {
      id: "dendro.window",
      kind: "dendro:window",
      owner: "dendro",
      props: { replaced: true },
      children: [],
    },
    pages: [{ id: "page.detail", label: "详情", route: "/ideas/:id", owner: "ideas" }],
    active: "page.detail",
    data: { "ideas.detail": { revision: 2, value: { id: "42" } } },
    version,
  };
}

function denied(result: ReturnType<typeof applyFullWithPermission>) {
  if (result.ok) {
    throw new Error("应拒绝");
  }
  return result.diagnostics;
}

describe("applyFullWithPermission：根级 replace 闸门", () => {
  it("当前根没有 replace 授权：E-PERMISSION，现场指向当前根与它的 owner", () => {
    const current = sessionOf(readFixture());

    const diagnostics = denied(
      applyFullWithPermission(current, replacementDocument(4), { owner: "ideas" }),
    );

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-PERMISSION"]);
    expect(diagnostics[0]?.owner).toBe("dendro");
    expect(diagnostics[0]?.slot).toBe("dendro.window");
    expect(diagnostics[0]?.message).toContain("ideas");
    expect(diagnostics[0]?.message).toContain("replace");
  });

  it("当前根显式授予 replace：放行，返回新会话", () => {
    const document = structuredClone(readFixture());
    recordOf(document.document).grant = { replace: ["ideas"] };
    const current = sessionOf(document);

    const replaced = applyFullWithPermission(current, replacementDocument(4), { owner: "ideas" });

    expect(replaced.ok).toBe(true);
    if (replaced.ok) {
      expect(replaced.session.document.version).toBe(4);
      expect(replaced.session.active).toBe("page.detail");
    }
  });

  it("没有 requester = 系统来源：放行", () => {
    const replaced = applyFullWithPermission(sessionOf(readFixture()), replacementDocument(4));

    expect(replaced.ok).toBe(true);
    if (replaced.ok) {
      expect(replaced.session.document.version).toBe(4);
    }
  });

  it("首次全量（current 为 null）：没有可检查目标，放行", () => {
    const replaced = applyFullWithPermission(null, replacementDocument(4), { owner: "ideas" });

    expect(replaced.ok).toBe(true);
    if (replaced.ok) {
      expect(replaced.session.document.version).toBe(4);
    }
  });

  it("新文档内部的 grant 不参与：替换文档给自己发 replace 也无效", () => {
    const replacement = replacementDocument(4);
    recordOf(replacement.document).grant = { replace: ["ideas"] };

    const diagnostics = denied(
      applyFullWithPermission(sessionOf(readFixture()), replacement, { owner: "ideas" }),
    );

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-PERMISSION"]);
  });

  it("形状 / 版本错误优先于权限：越权 requester 先拿到 E-VERSION / E-PAYLOAD", () => {
    const current = sessionOf(readFixture());
    const requester = { owner: "ideas" };

    const version = denied(applyFullWithPermission(current, replacementDocument(2), requester));
    const payload = denied(
      applyFullWithPermission(
        current,
        {
          schema: "dendro.ui/1",
          document: { id: "broken" },
          pages: [],
          active: "",
          data: {},
          version: 4,
        },
        requester,
      ),
    );

    expect(version.map((diagnostic) => diagnostic.code)).toEqual(["E-VERSION"]);
    expect(payload.map((diagnostic) => diagnostic.code)).toEqual(["E-PAYLOAD"]);
  });
});

describe("EngineRuntime.applyFull：权限接线", () => {
  it("requester 没有 replace：整份不变、记拒绝与 deny、不通知", () => {
    const engine = engineOf(readFixture(), { owner: "ideas" });
    const before = structuredClone(engine.session);
    let notified = 0;
    engine.onChange(() => {
      notified += 1;
    });

    const diagnostics = failed(engine.applyFull(replacementDocument(4)));

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-PERMISSION"]);
    expect(engine.session).toEqual(before);
    expect(engine.metrics).toMatchObject({
      version: 3,
      fullUpdates: 0,
      rejections: 1,
      notifications: 0,
    });
    expect(notified).toBe(0);
    expect(engine.audit.entries()).toMatchObject([
      { kind: "reject", code: "E-PERMISSION", changed: 0 },
      { kind: "deny", code: "E-PERMISSION", owner: "dendro", slot: "dendro.window", changed: 0 },
    ]);
  });

  it("当前根授予 replace 时全量成功：版本 / 指标前进，通知一次", () => {
    const document = structuredClone(readFixture());
    recordOf(document.document).grant = { replace: ["ideas"] };
    const engine = engineOf(document, { owner: "ideas" });
    const changes: string[][] = [];
    engine.onChange((_session, changed) => changes.push([...changed]));

    const result = applied(engine.applyFull(replacementDocument(4)));

    expect(result.changed).toEqual(["dendro.window"]);
    expect(engine.session.document.version).toBe(4);
    expect(engine.session.active).toBe("page.detail");
    expect(engine.metrics).toMatchObject({ fullUpdates: 1, rejections: 0, notifications: 1 });
    expect(changes).toEqual([["dendro.window"]]);
  });
});
