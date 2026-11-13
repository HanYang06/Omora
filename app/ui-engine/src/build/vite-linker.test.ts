import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "vite";
import { afterAll, describe, expect, it } from "vitest";
import { defaultFixturePath, linkerGatePlugin, runFixtureGate } from "./vite-linker";
import { fixturePayload } from "../link/test_fixtures";

const tempDirs: string[] = [];

function tempJsonFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "omora-linker-"));
  tempDirs.push(dir);
  const path = join(dir, "local-trees.json");
  writeFileSync(path, content, "utf8");
  return path;
}

function conflictPayloadJson(): string {
  const payload = fixturePayload();
  const audioMount = payload.trees[3];
  if (audioMount === undefined) {
    throw new Error("fixture 少了 audio 挂载树");
  }
  audioMount.order = 20;
  return JSON.stringify(payload);
}

function buildStartOf(plugin: Plugin): () => void {
  const hook = plugin.buildStart;
  if (typeof hook !== "function") {
    throw new Error("buildStart 应该是函数");
  }
  return hook as unknown as () => void;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("linkerGatePlugin：构建期门禁", () => {
  it("默认 fixture 路径指向共享 fixture", () => {
    expect(defaultFixturePath().replaceAll("\\", "/")).toContain(
      "app/sdk/tests/fixtures/local-trees.json",
    );
  });

  it("门禁对共享 fixture 通过", () => {
    const result = runFixtureGate(defaultFixturePath());

    expect(result.ok).toBe(true);
  });

  it("门禁对冲突 payload 报错，带诊断码", () => {
    const result = runFixtureGate(tempJsonFile(conflictPayloadJson()));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("E-SLOT-AMBIGUOUS");
    }
  });

  it("门禁对坏 JSON 报 E-PAYLOAD", () => {
    const result = runFixtureGate(tempJsonFile("{ not json "));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe("E-PAYLOAD");
    }
  });

  it("fixture 文件读不到时报 E-PAYLOAD", () => {
    const result = runFixtureGate(join(tmpdir(), "omora-missing-fixture.json"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe("E-PAYLOAD");
    }
  });

  it("vite buildStart 在共享 fixture 上不抛", () => {
    const plugin = linkerGatePlugin();

    expect(plugin.name).toBe("omora-linker-gate");
    expect(() => {
      buildStartOf(plugin)();
    }).not.toThrow();
  });

  it("vite buildStart 对冲突 fixture 抛错，构建失败", () => {
    const plugin = linkerGatePlugin({ fixturePath: tempJsonFile(conflictPayloadJson()) });

    expect(() => {
      buildStartOf(plugin)();
    }).toThrow(/Dendrolink 链接期门禁失败/);
  });
});
