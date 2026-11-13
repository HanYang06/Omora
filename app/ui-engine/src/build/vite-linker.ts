/**
 * 构建期门禁：vite build 时编译共享 fixture，冲突直接让构建失败。
 *
 * 路径相对本文件（`app/ui-engine/src/build/` → `app/sdk/tests/fixtures/`），
 * 与 Python 侧共用同一份 fixture。纯函数 `runFixtureGate` 单独导出供测试。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { link } from "../link/link";
import { WINDOW_SCAFFOLD } from "../link/scaffold";
import type { Diagnostic } from "../contract/diagnostics";
import type { LinkResult } from "../link/types";

const FIXTURE_URL = new URL("../../../sdk/tests/fixtures/local-trees.json", import.meta.url);

/** 共享 fixture 的绝对路径（与 import.meta.url 相对，避免依赖 cwd）。 */
export function defaultFixturePath(): string {
  return fileURLToPath(FIXTURE_URL);
}

/** 读文件、解析 JSON、跑链接；任何一步失败都回诊断，不抛。 */
export function runFixtureGate(fixturePath: string): LinkResult {
  let raw: string;
  try {
    raw = readFileSync(fixturePath, "utf8");
  } catch (error) {
    return {
      ok: false,
      diagnostics: [payloadDiagnostic(`读取 fixture 失败: ${String(error)}`, fixturePath)],
    };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      diagnostics: [payloadDiagnostic(`fixture 不是合法 JSON: ${String(error)}`, fixturePath)],
    };
  }
  return link(WINDOW_SCAFFOLD, payload);
}

function payloadDiagnostic(message: string, path: string): Diagnostic {
  return { severity: "error", code: "E-PAYLOAD", message, path };
}

export interface LinkerGateOptions {
  /** 测试用：换一份 fixture；默认共享 fixture。 */
  fixturePath?: string;
}

/**
 * Vite 插件：buildStart 读 fixture 并链接，有诊断就抛错。
 * 只在构建期跑，不进客户端模块图。
 */
export function linkerGatePlugin(options: LinkerGateOptions = {}): Plugin {
  return {
    name: "omora-linker-gate",
    buildStart() {
      const fixturePath = options.fixturePath ?? defaultFixturePath();
      const result = runFixtureGate(fixturePath);
      if (result.ok) {
        return;
      }
      const detail = result.diagnostics
        .map((diagnostic) => `  ${diagnostic.code}: ${diagnostic.message}`)
        .join("\n");
      throw new Error(`Dendrolink 链接期门禁失败（${fixturePath}）：\n${detail}`);
    },
  };
}
