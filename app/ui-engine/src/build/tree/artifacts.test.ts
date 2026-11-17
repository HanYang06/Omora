import { describe, expect, it } from "vitest";
import type { Document, Node, Partial } from "../../contract/tree_generated";
import {
  TREE_BUILD_FORMAT,
  artifactFile,
  buildTreeArtifacts,
  countNodes,
  type TreeBuildInput,
} from "./artifacts";

const ROOT = "aaaaaaaaaaaaaaaa";
const NAV = "bbbbbbbbbbbbbbbb";
const PAGE = "cccccccccccccccc";
const LINK = "dddddddddddddddd";
const TEXT = "eeeeeeeeeeeeeeee";

function node(id: string, chain: string, order: number, layout: Node[] = []): Node {
  return {
    id,
    chain,
    kind: "column",
    order,
    layout,
    settings: {},
    bind: {},
    on: {},
    emit: {},
  };
}

function baseDocument(): Document {
  return {
    schema: "dendro.tree/1",
    version: 1,
    root: {
      ...node(ROOT, ROOT, 0, [node(NAV, `${ROOT}.${NAV}`, 10), node(PAGE, `${ROOT}.${PAGE}`, 20)]),
      kind: "app",
    },
    pages: [{ id: PAGE, title: "灵感", route: "/ideas" }],
    active: PAGE,
    data: {},
  };
}

function navPartial(): Partial {
  return {
    schema: "dendro.tree/1",
    source: "ui",
    mount: { parent: NAV, mode: "new" },
    root: {
      ...node(LINK, `${ROOT}.${NAV}.${LINK}`, 10),
      kind: "page-link",
      settings: { label: "灵感", route: "/ideas", active: true },
    },
  };
}

function contentPartial(): Partial {
  return {
    schema: "dendro.tree/1",
    source: "ideas",
    mount: { parent: PAGE, mode: "new" },
    root: { ...node(TEXT, `${ROOT}.${PAGE}.${TEXT}`, 10), kind: "text", settings: { text: "空" } },
  };
}

function input(
  pages: TreeBuildInput["pages"] = [
    {
      name: "ideas",
      title: "灵感",
      route: "/ideas",
      base: baseDocument(),
      partials: [navPartial(), contentPartial()],
    },
  ],
): TreeBuildInput {
  return { format: TREE_BUILD_FORMAT, default: pages[0]?.name ?? "ideas", pages };
}

function walk(node: Node): Node[] {
  return [node, ...node.layout.flatMap(walk)];
}

describe("buildTreeArtifacts：每页一份文档 + manifest", () => {
  it("按页拆文件：一页一个 doc，manifest 指过去", () => {
    const result = buildTreeArtifacts(
      input([
        {
          name: "ideas",
          title: "灵感",
          route: "/ideas",
          base: baseDocument(),
          partials: [contentPartial()],
        },
        {
          name: "projects",
          title: "项目",
          route: "/projects",
          base: baseDocument(),
          partials: [contentPartial()],
        },
      ]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.documents.map((document) => document.file)).toEqual([
      "tree/pages/ideas.json",
      "tree/pages/projects.json",
    ]);
    expect(result.manifest.format).toBe(TREE_BUILD_FORMAT);
    expect(result.manifest.default).toBe("ideas");
    expect(result.manifest.pages.map((page) => page.name)).toEqual(["ideas", "projects"]);
    expect(result.manifestJson).toContain('"tree/pages/ideas.json"');
  });

  it("组合后的文档里真有局部树挂上去的节点", () => {
    const result = buildTreeArtifacts(input());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const document = JSON.parse(result.documents[0]?.json ?? "{}") as Document;
    const ids = walk(document.root).map((entry) => entry.id);
    expect(ids).toContain(LINK);
    expect(ids).toContain(TEXT);
    expect(document.active).toBe(PAGE);
  });

  it("hash 是 16 位十六进制，节点数按 layout 统计", () => {
    const result = buildTreeArtifacts(input());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const document = result.documents[0];
    expect(document?.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(document?.nodes).toBe(5);
    expect(countNodes(baseDocument().root)).toBe(3);
  });

  it("两份相同输入得到同一批文件名与 hash", () => {
    const first = buildTreeArtifacts(input());
    const second = buildTreeArtifacts(input());

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.documents[0]?.hash).toBe(second.documents[0]?.hash);
    expect(first.manifestJson).toBe(second.manifestJson);
  });
});

describe("buildTreeArtifacts：失败不产半套产物", () => {
  it("局部树 chain 不对：报 E-TREE-CHAIN，路径带页下标", () => {
    const broken = contentPartial();
    broken.root.chain = `${ROOT}.${PAGE}.ffffffffffffffff`;
    const result = buildTreeArtifacts(
      input([
        { name: "ideas", title: "灵感", route: "/ideas", base: baseDocument(), partials: [broken] },
      ]),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("E-TREE-CHAIN");
    expect(result.diagnostics[0]?.path.startsWith("pages[0].")).toBe(true);
  });

  it("重复页面名：E-BUILD-INPUT，不进入组合", () => {
    const result = buildTreeArtifacts(
      input([
        { name: "ideas", title: "灵感", route: "/ideas", base: baseDocument(), partials: [] },
        { name: "ideas", title: "又一个", route: "/ideas2", base: baseDocument(), partials: [] },
      ]),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-BUILD-INPUT"]);
  });

  it("format 不对：E-BUILD-INPUT", () => {
    const result = buildTreeArtifacts({ ...input(), format: "omora.tree.build/0" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.path).toBe("format");
  });

  it("default 不在页面里：E-BUILD-INPUT", () => {
    const result = buildTreeArtifacts({ ...input(), default: "missing" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.path).toBe("default");
  });

  it("空页面：E-BUILD-INPUT", () => {
    const result = buildTreeArtifacts({ format: TREE_BUILD_FORMAT, default: "ideas", pages: [] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((diagnostic) => diagnostic.path === "pages")).toBe(true);
  });
});

describe("artifactFile", () => {
  it("文件路径固定为 tree/pages/<name>.json", () => {
    expect(artifactFile("ideas")).toBe("tree/pages/ideas.json");
  });
});
