/**
 * 运行后来源（S7）：不改引擎源码，往窗口挂一棵局部树。
 *
 * 来源是自动发现的：`src/app/runtime_sources/` 下每个模块一个默认导出（`RuntimeSource`）。
 * 加一个来源 = 加一个文件，不需要改引擎源码或注册表；宿主负责把它注册进 SourceEngine，
 * 需要热更新时来源自己通过 `start(push)` 交新树，宿主按 owner 整组替换。
 *
 * 与主视图的关系：主视图（Python 的 ui.render / ui.event）对页面与导航负责，运行后来源
 * 是额外 owner；applyView 时用 keepOwners 保留它们，不会被整份视图替换掉。
 */

import type { SlotNode } from "../contract/document";
import type { SourceEngine } from "../host/engine_sources";
import type { LocalTree } from "../link/types";
import type { Logger } from "./log";

/** 一个运行后来源：owner + 挂载点 + 当前树；可选 start 做热更新。 */
export interface RuntimeSource {
  owner: string;
  mountAt: string;
  order?: number;
  build(): SlotNode;
  /** 需要持续更新时返回新树；返回值是清理函数。 */
  start?(push: (root: SlotNode) => void): () => void;
}

interface RuntimeModule {
  default?: RuntimeSource;
}

/**
 * 自动发现的来源模块。加文件即加载，不需要中心注册表；模块没默认导出就跳过并记日志。
 * 用 eager 是因为首帧视图之后马上要注册，不值得为几个小模块拆异步加载。
 */
const modules = import.meta.glob<RuntimeModule>("./runtime_sources/*.ts", { eager: true });

function treeOf(source: RuntimeSource, root: SlotNode, seq: number): LocalTree {
  return {
    owner: source.owner,
    root,
    mountAt: source.mountAt,
    order: source.order ?? 0,
    seq,
    replace: false,
  };
}

/** 列出所有可用来源（按 owner 排序，保证注册顺序稳定）。 */
export function runtimeSources(): RuntimeSource[] {
  const sources: RuntimeSource[] = [];
  for (const [path, module] of Object.entries(modules)) {
    const source = module.default;
    if (source === undefined) {
      console.error("[omora] 运行后来源模块缺默认导出:", path);
      continue;
    }
    sources.push(source);
  }
  return sources.sort((left, right) => left.owner.localeCompare(right.owner));
}

/** 已挂载来源的句柄：owner 列表供 applyView 保留，dispose 收掉热更新。 */
export interface RuntimeMount {
  owners(): string[];
  dispose(): void;
}

/**
 * 把来源注册进 SourceEngine；单个来源坏掉只跳过它自己。
 * 注册 / 热更新失败都记日志、保留上一棵好树（SourceHost 语义）。
 */
export function mountRuntimeSources(
  engine: SourceEngine,
  sources: readonly RuntimeSource[],
  log: Logger,
): RuntimeMount {
  const cleanups: Array<() => void> = [];
  const seqs = new Map<string, number>();

  function register(source: RuntimeSource, root: SlotNode): boolean {
    if (root.owner !== source.owner) {
      log.error("runtime_source.owner_mismatch", { owner: source.owner, actual: root.owner });
      return false;
    }
    const seq = (seqs.get(source.owner) ?? 0) + 1;
    seqs.set(source.owner, seq);
    const result = engine.registerSource(source.owner, [treeOf(source, root, seq)]);
    if (!result.ok) {
      log.error("runtime_source.register_failed", {
        owner: source.owner,
        codes: result.diagnostics.map((diagnostic) => diagnostic.code).join(","),
      });
      return false;
    }
    return true;
  }

  for (const source of sources) {
    let root: SlotNode;
    try {
      root = source.build();
    } catch (error) {
      log.error("runtime_source.build_failed", { owner: source.owner, err: String(error) });
      continue;
    }
    if (!register(source, root) || source.start === undefined) {
      continue;
    }
    try {
      cleanups.push(
        source.start((next) => {
          try {
            register(source, next);
          } catch (error) {
            log.error("runtime_source.update_failed", { owner: source.owner, err: String(error) });
          }
        }),
      );
    } catch (error) {
      log.error("runtime_source.start_failed", { owner: source.owner, err: String(error) });
    }
  }

  return {
    owners: () => sources.map((source) => source.owner),
    dispose: () => {
      while (cleanups.length > 0) {
        cleanups.pop()?.();
      }
    },
  };
}
