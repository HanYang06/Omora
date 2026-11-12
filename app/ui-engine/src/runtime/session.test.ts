import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DocumentIndex } from "./document";
import {
  applyFull,
  applySessionOps,
  createSession,
  type ApplyFullResult,
  type SessionState,
} from "./session";

/**
 * 共享 fixture（不许改）：document.json 是 version 3 的整份 v2 文档（active page.ideas）；
 * route.json 是 base 3 → document 4、仅一条 route page.ideas 的 ops 批量。
 */
const DOCUMENT_FIXTURE_PATH = fileURLToPath(
  new URL("../../../sdk/tests/fixtures/document.json", import.meta.url),
);
const ROUTE_FIXTURE_PATH = fileURLToPath(
  new URL("../../../sdk/tests/fixtures/route.json", import.meta.url),
);

function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("应该是对象: " + JSON.stringify(value));
  }
  return value as Record<string, unknown>;
}

function arrayOf(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error("应该是数组: " + JSON.stringify(value));
  }
  return value;
}

function readFixture(path: string): Record<string, unknown> {
  return recordOf(JSON.parse(readFileSync(path, "utf8")));
}

function sessionOf(value: unknown): SessionState {
  const result = createSession(value);
  if (!result.ok) {
    throw new Error("测试文档应合法: " + JSON.stringify(result.diagnostics));
  }
  return result.session;
}

function createFailed(value: unknown) {
  const result = createSession(value);
  if (result.ok) {
    throw new Error("文档应校验失败");
  }
  return result.diagnostics;
}

function nodeProps(session: SessionState, id: string): Record<string, unknown> | undefined {
  return DocumentIndex.build(session.document.root).get(id)?.props;
}

/** 两页文档：active 在 page.ideas，树上只物化当前页（structure.md §2）。 */
function twoPageDocument(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "dendro.ui/2",
    document: {
      id: "dendro.window",
      kind: "dendro:window",
      owner: "dendro",
      props: {},
      layout: { flow: "row", capacity: "many" },
      children: [
        {
          id: "dendro.window.page",
          kind: "dendro:slot",
          owner: "dendro",
          props: {},
          layout: { flow: "column", capacity: "one" },
          children: [
            {
              id: "page.ideas",
              kind: "dendro:page",
              owner: "ideas",
              props: { label: "灵感" },
              children: [],
            },
          ],
        },
      ],
    },
    pages: [
      { id: "page.ideas", label: "灵感", route: "/ideas", owner: "ideas" },
      { id: "page.detail", label: "灵感详情", route: "/ideas/:id", owner: "ideas" },
    ],
    active: "page.ideas",
    data: { "session.status": { revision: 1, value: { connected: true } } },
    version: 3,
    ...over,
  };
}

/** 全量替换用的另一份文档：树 / pages / active / data 全不同。 */
function replacementDocument(version: number): Record<string, unknown> {
  return {
    schema: "dendro.ui/2",
    document: {
      id: "dendro.window",
      kind: "dendro:window",
      owner: "dendro",
      props: { replaced: true },
      layout: { flow: "row", capacity: "many" },
      children: [
        { id: "page.detail", kind: "dendro:page", owner: "ideas", props: {}, children: [] },
      ],
    },
    pages: [{ id: "page.detail", label: "详情", route: "/ideas/:id", owner: "ideas" }],
    active: "page.detail",
    data: { "ideas.detail": { revision: 2, value: { id: "42" } } },
    version,
  };
}

function sessionBatchOf(base: number, ops: unknown[]): Record<string, unknown> {
  return { kind: "ops", document: base + 1, base, seq: 1, ops };
}

function applied(session: SessionState, batch: unknown) {
  const result = applySessionOps(session, batch);
  if (!result.ok) {
    throw new Error("会话 ops 应应用成功: " + JSON.stringify(result.diagnostics));
  }
  return result;
}

function sessionFailed(session: SessionState, batch: unknown) {
  const result = applySessionOps(session, batch);
  if (result.ok) {
    throw new Error("会话 ops 应应用失败");
  }
  return result.diagnostics;
}

function fullApplied(current: SessionState | null, value: unknown): SessionState {
  const result: ApplyFullResult = applyFull(current, value);
  if (!result.ok) {
    throw new Error("全量替换应成功: " + JSON.stringify(result.diagnostics));
  }
  return result.session;
}

function fullFailed(current: SessionState | null, value: unknown) {
  const result = applyFull(current, value);
  if (result.ok) {
    throw new Error("全量替换应失败");
  }
  return result.diagnostics;
}

describe("createSession：共享 document fixture", () => {
  it("version 3、active page.ideas、一张页面、根树与 data 可定位", () => {
    const session = sessionOf(readFixture(DOCUMENT_FIXTURE_PATH));

    expect(session.document.version).toBe(3);
    expect(session.active).toBe("page.ideas");
    expect(session.pages).toEqual([
      { id: "page.ideas", label: "灵感", route: "/ideas", owner: "ideas" },
    ]);
    const index = DocumentIndex.build(session.document.root);
    expect(session.document.root.id).toBe("dendro.window");
    expect(index.get("ideas.feed")?.kind).toBe("dendro:slot");
    expect(index.get("tpl.ideas.item")?.owner).toBe("ideas");
    expect(index.slotsFor("ideas.feed")).toEqual(["ideas.feed"]);
    expect(session.data["ideas.feed"]).toEqual({
      revision: 5,
      items: [{ id: "42", template: "item", title: "买牛奶", meta: "刚刚" }],
    });
  });

  it("深拷：不改写入参，改线上 payload 不影响会话的 root / pages / data", () => {
    const raw = readFixture(DOCUMENT_FIXTURE_PATH);
    const snapshot = structuredClone(raw);
    const expectedFeed = structuredClone(recordOf(raw.data)["ideas.feed"]);

    const session = sessionOf(raw);

    expect(raw).toEqual(snapshot);
    recordOf(raw.document).children = [{ id: "external" }];
    recordOf(raw.data)["ideas.feed"] = { revision: 99 };
    arrayOf(raw.pages)[0] = { id: "page.external" };
    expect(session.document.root.children[0]?.id).toBe("dendro.window.nav");
    expect(session.data["ideas.feed"]).toEqual(expectedFeed);
    expect(session.pages[0]?.label).toBe("灵感");
  });

  it("不可深拷的 data（函数值）→ E-PAYLOAD，不抛", () => {
    const document = twoPageDocument();
    document.data = { "session.status": { revision: 1, value: { handler: () => 1 } } };

    const diagnostics = createFailed(document);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-PAYLOAD"]);
    expect(diagnostics[0]?.path).toBe("$");
  });

  it("文档不合法 → 诊断（不抛）：bad_version / bad_schema / 重复 id", () => {
    const badVersion = createFailed(twoPageDocument({ version: 0 }));
    expect(badVersion.map((diagnostic) => diagnostic.code)).toEqual(["E-VERSION"]);
    expect(badVersion[0]?.path).toBe("$.version");

    const badSchemaDocument = twoPageDocument();
    badSchemaDocument.schema = "dendro.ui/3";
    const badSchema = createFailed(badSchemaDocument);
    expect(badSchema.map((diagnostic) => diagnostic.code)).toEqual(["E-PAYLOAD"]);
    expect(badSchema[0]?.path).toBe("$.schema");

    const duplicate = twoPageDocument();
    const pageSlot = recordOf(arrayOf(recordOf(duplicate.document).children)[0]);
    arrayOf(pageSlot.children).push({
      id: "dendro.window",
      kind: "dendro:slot",
      owner: "dendro",
      props: {},
      children: [],
    });
    expect(createFailed(duplicate).map((diagnostic) => diagnostic.code)).toEqual([
      "E-ID-DUPLICATE",
    ]);
  });
});

describe("applySessionOps：共享 route fixture", () => {
  it("route page.ideas：版本 3→4、active 不变、changed 空、树与 data 不变", () => {
    const session = sessionOf(readFixture(DOCUMENT_FIXTURE_PATH));
    const beforeRoot = session.document.root;
    const beforeData = session.data;

    const result = applied(session, readFixture(ROUTE_FIXTURE_PATH));

    expect(result.session.document.version).toBe(4);
    expect(result.session.active).toBe("page.ideas");
    expect(result.changed).toEqual([]);
    expect(result.session.document.root).toEqual(beforeRoot);
    expect(result.session.data).toEqual(beforeData);
  });

  it("不改写入参：原 session 与 fixture payload 都原样", () => {
    const session = sessionOf(readFixture(DOCUMENT_FIXTURE_PATH));
    const route = readFixture(ROUTE_FIXTURE_PATH);
    const sessionSnapshot = structuredClone(session);
    const routeSnapshot = structuredClone(route);

    applied(session, route);

    expect(session).toEqual(sessionSnapshot);
    expect(route).toEqual(routeSnapshot);
  });
});

describe("applySessionOps：route 切页", () => {
  it("route 到另一页：active 改变、版本只涨一次、根树不动、changed 空", () => {
    const session = sessionOf(twoPageDocument());
    const beforeRoot = session.document.root;

    const result = applied(
      session,
      sessionBatchOf(3, [{ op: "route", page: "page.detail", params: { id: "42" } }]),
    );

    expect(result.session.active).toBe("page.detail");
    expect(result.session.document.version).toBe(4);
    expect(result.session.document.root).toEqual(beforeRoot);
    expect(result.session.pages).toEqual(session.pages);
    expect(result.changed).toEqual([]);
  });

  it("多条 route 按声明顺序，最后一条生效", () => {
    const session = sessionOf(twoPageDocument());

    const result = applied(
      session,
      sessionBatchOf(3, [
        { op: "route", page: "page.detail" },
        { op: "route", page: "page.ideas" },
      ]),
    );

    expect(result.session.active).toBe("page.ideas");
    expect(result.session.document.version).toBe(4);
  });

  it("route 目标页不存在 → E-TARGET-MISSING，整批原子失败、session 原样", () => {
    const session = sessionOf(twoPageDocument());
    const snapshot = structuredClone(session);

    const diagnostics = sessionFailed(
      session,
      sessionBatchOf(3, [{ op: "route", page: "page.missing" }]),
    );

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-TARGET-MISSING"]);
    expect(diagnostics[0]?.path).toBe("$.ops[0].page");
    expect(diagnostics[0]?.message).toContain("page.missing");
    expect(session).toEqual(snapshot);
  });
});

describe("applySessionOps：route 与树 op 混批", () => {
  it("成功：树 op 生效、active 切换、版本只涨一次、changed 只含树 op", () => {
    const session = sessionOf(twoPageDocument());

    const result = applied(
      session,
      sessionBatchOf(3, [
        { op: "update", id: "page.ideas", props: { label: "灵感改" } },
        { op: "route", page: "page.detail", params: { id: "42" } },
      ]),
    );

    expect(result.session.document.version).toBe(4);
    expect(result.session.active).toBe("page.detail");
    expect(result.changed).toEqual(["page.ideas"]);
    expect(nodeProps(result.session, "page.ideas")?.label).toBe("灵感改");
  });

  it("route 非法时树 op 不生效：整批原子", () => {
    const session = sessionOf(twoPageDocument());
    const snapshot = structuredClone(session);

    const diagnostics = sessionFailed(
      session,
      sessionBatchOf(3, [
        { op: "update", id: "page.ideas", props: { label: "不应生效" } },
        { op: "route", page: "page.missing" },
      ]),
    );

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-TARGET-MISSING"]);
    expect(session).toEqual(snapshot);
    expect(nodeProps(session, "page.ideas")?.label).toBe("灵感");
    expect(nodeProps(session, "page.ideas")?.label).not.toBe("不应生效");
  });

  it("树 op 失败时 route 也不生效：active 与版本都不动", () => {
    const session = sessionOf(twoPageDocument());

    const diagnostics = sessionFailed(
      session,
      sessionBatchOf(3, [
        { op: "route", page: "page.detail" },
        { op: "update", id: "page.nope", props: {} },
      ]),
    );

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-TARGET-MISSING"]);
    expect(diagnostics[0]?.path).toBe("$.ops[1].id");
    expect(session.active).toBe("page.ideas");
    expect(session.document.version).toBe(3);
  });
});

describe("applySessionOps：版本与形状", () => {
  it("base 与当前文档版本不一致 → E-VERSION，session 不变", () => {
    const session = sessionOf(twoPageDocument());
    const snapshot = structuredClone(session);

    const diagnostics = sessionFailed(session, sessionBatchOf(2, []));

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-VERSION"]);
    expect(diagnostics[0]?.path).toBe("$.base");
    expect(session).toEqual(snapshot);
  });

  it("document 不是 base + 1 → E-VERSION", () => {
    const session = sessionOf(twoPageDocument());

    const diagnostics = sessionFailed(session, {
      kind: "ops",
      document: 5,
      base: 3,
      seq: 1,
      ops: [],
    });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-VERSION"]);
    expect(diagnostics[0]?.path).toBe("$.document");
  });

  it("payload 形状不合法 → E-PAYLOAD（parseOps 诊断原样回传，不抛）", () => {
    const session = sessionOf(twoPageDocument());

    const diagnostics = sessionFailed(session, { kind: "data", source: "x" });

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.every((diagnostic) => diagnostic.code === "E-PAYLOAD")).toBe(true);
  });
});

describe("applyFull：全量替换", () => {
  it("更新版本接受：root / pages / active / data / version 全换，旧 data 不合并", () => {
    const session = sessionOf(twoPageDocument());

    const next = fullApplied(session, replacementDocument(4));

    expect(next.document.version).toBe(4);
    expect(next.active).toBe("page.detail");
    expect(next.pages.map((page) => page.id)).toEqual(["page.detail"]);
    expect(next.document.root.props).toEqual({ replaced: true });
    expect(DocumentIndex.build(next.document.root).get("page.ideas")).toBeUndefined();
    expect(Object.keys(next.data)).toEqual(["ideas.detail"]);
  });

  it("同版本接受（幂等重放同一份全量）", () => {
    const session = sessionOf(twoPageDocument());

    const next = fullApplied(session, twoPageDocument());

    expect(next.document.version).toBe(3);
    expect(next.active).toBe("page.ideas");
    expect(next.document.root).toEqual(session.document.root);
  });

  it("旧版本拒绝 → E-VERSION，现会话原样", () => {
    const session = sessionOf(twoPageDocument());
    const snapshot = structuredClone(session);

    const diagnostics = fullFailed(session, replacementDocument(2));

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-VERSION"]);
    expect(diagnostics[0]?.path).toBe("$.version");
    expect(session).toEqual(snapshot);
  });

  it("current 为 null：首份全量直接接受", () => {
    const next = fullApplied(null, replacementDocument(1));

    expect(next.document.version).toBe(1);
    expect(next.active).toBe("page.detail");
  });

  it("深拷：不改写入参，改线上全量不影响会话", () => {
    const value = replacementDocument(4);
    const snapshot = structuredClone(value);
    const session = sessionOf(twoPageDocument());

    const next = fullApplied(session, value);

    expect(value).toEqual(snapshot);
    recordOf(value.document).props = { replaced: false };
    recordOf(value.data)["ideas.detail"] = { revision: 9 };
    expect(next.document.root.props).toEqual({ replaced: true });
    expect(next.data["ideas.detail"]).toEqual({ revision: 2, value: { id: "42" } });
  });

  it("全量文档不合法 → 形状诊断（不抛）", () => {
    const badSchema = replacementDocument(4);
    badSchema.schema = "dendro.ui/3";
    expect(fullFailed(null, badSchema).map((diagnostic) => diagnostic.code)).toEqual(["E-PAYLOAD"]);

    const badVersion = replacementDocument(0);
    expect(fullFailed(null, badVersion).map((diagnostic) => diagnostic.code)).toEqual([
      "E-VERSION",
    ]);
  });
});
