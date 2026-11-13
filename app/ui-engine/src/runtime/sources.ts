/**
 * Dendrolink 引擎侧的来源宿主（Producer Host，S4/S5）：局部树注册表 → 权威根树。
 *
 * 依据 docs/engine/composition.md §5「时机」与 §7「局部树的生命周期」：
 * - 每个来源（插件 / worker / 独立进程 / 测试 fixture）登记自己的局部树；宿主把所有
 *   来源的局部树拼成一个 local-trees payload，交给链接器重算唯一权威根树。
 * - load 是整组替换（线上 local-trees 全量负载的入口）：给定树一次重链接落成，允许
 *   空数组（清空来源）；跨 owner 依赖（B 的树挂进 A 树声明的 slot）在同一批里解析。
 * - requesterFor 原样透传给链接器，register / remove / load 的重链接都生效；不传 =
 *   系统来源全放行（链接器默认）。
 * - fail closed：链接失败时 registry 与当前根树都不变，只回诊断；调用方修好再重试。
 * - 来源被撤时，挂在它声明的 slot 下的其他来源贡献失去落点（E-TARGET-MISSING），
 *   级联撤掉这些树并各记一条死引用诊断；若重链接仍失败（歧义 / 容量 / 环等），
 *   整次 remove 回滚——registry 与根树保持操作前的样子。
 * - 级联有界：每轮至少撤掉一棵树，轮数上界是注册树总数，不会无限循环。
 *
 * 为什么以链接器诊断为准：链接器已经是「这组局部树能否落成一棵树」的唯一判据，宿主
 * 只做编排（注册表快照 → 链接 → 成功才提交），不复制排序 / 容量 / 环逻辑。注册成功的
 * 来源集里本来没有死引用，所以撤掉一个来源后新出现的 E-TARGET-MISSING 只可能来自它
 * 声明过的 slot（含子树里的 slot）；按 slot 找失去落点的树再重链，即可覆盖多层依赖。
 *
 * 边界（写清楚，避免调用方误用）：
 * - registry 保存调用方给的局部树引用（不深拷）；宿主从不改写它们，调用方在 register
 *   之后不得再改这些对象——要改就重新 register 一棵新树。
 * - base 同样按引用保存（链接器每次链接都会深拷，改不到 base）：调用方应把它当只读；
 *   构造后再改 base 会影响下一次重链接。
 * - tree getter 直接给当前权威根树，调用方只读、不得原地改（每次链接成功都换新树）。
 * - 未注册任何来源时 tree 就是构造时给的 base（默认 WINDOW_SCAFFOLD）。
 * - remove 一个未注册的 owner 是幂等空操作（返回当前树、dropped / 诊断为空）：撤来源
 *   本身不是失败，重复撤销不应该报错。
 * - register / remove / load 都是整体提交：链接成功才替换内部状态，失败只回诊断。
 * - dispose 复用 E-PAYLOAD 表示「调用方时机错误」，与 runtime/engine.ts 一致。
 */

import type { SlotNode } from "../contract/document";
import { link } from "../link/link";
import { sortDiagnostics } from "../link/parse";
import { WINDOW_SCAFFOLD } from "../link/scaffold";
import type { Diagnostic } from "../contract/diagnostics";
import type { LinkResult, LocalTree, LocalTreesPayload } from "../link/types";
import { makeDiagnostic } from "../contract/diagnostics";
import { LifecycleLedger, type DisposeReport } from "./lifecycle";
import type { Requester } from "./permissions";

/** 级联撤掉的一棵局部树：属于哪个来源、原本挂到哪个 slot。 */
export interface DroppedSource {
  owner: string;
  mountAt: string;
}

/**
 * 一次 register / remove / load 的结果。
 *
 * 成功给当前权威根树与本次记录（register / load 的 dropped 恒为空）；失败只给诊断，
 * registry 与根树保持操作前的样子（原子回滚）。
 */
export type SourceHostResult =
  | { ok: true; tree: SlotNode; diagnostics: Diagnostic[]; dropped: DroppedSource[] }
  | { ok: false; diagnostics: Diagnostic[] };

/** 构造 SourceHost 的可选设施；缺省为窗口骨架 + 自建账本。 */
export interface SourceHostOptions {
  /** 链接基准；缺省 WINDOW_SCAFFOLD。按引用保存，调用方应视为只读。 */
  base?: SlotNode;
  /** 生命周期账本；缺省自建。dispose 时整本收口。 */
  ledger?: LifecycleLedger;
  /**
   * 每棵局部树的请求主体，透传给链接器的 requesterFor（register / remove / load 的
   * 重链接都生效）；不传 = 系统来源全放行。
   */
  requesterFor?: (tree: LocalTree) => Requester;
}

/** dispose 之后的操作拒绝信息：引擎已收口，继续登记 / 撤销 / 整组 load 属调用方时机错误。 */
const DISPOSED_MESSAGE = "来源宿主已销毁（dispose），不再接受 register / remove / load";

/** dispose 之后的统一拒绝：E-PAYLOAD，与 EngineRuntime.dispose 的约定一致。 */
function disposedFailure(): SourceHostResult {
  return {
    ok: false,
    diagnostics: [makeDiagnostic("E-PAYLOAD", DISPOSED_MESSAGE, { path: "$" })],
  };
}

/** owner 必须是非空字符串；失败返回诊断（不抛）。path 让 register / load 各自定位现场。 */
function validateOwner(owner: unknown, path = "$.owner"): Diagnostic | undefined {
  if (typeof owner !== "string" || owner.trim() === "") {
    return makeDiagnostic("E-PAYLOAD", "来源 owner 必须是非空字符串", { path });
  }
  return undefined;
}

/** 运行期防御：调用方可能绕过类型传错形状；只回诊断，不抛，也不收窄静态类型。 */
function isObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 运行期防御：trees 必须是数组；同上，不做类型收窄。 */
function isObjectArray(value: unknown): boolean {
  return Array.isArray(value);
}

/** register / load 的宿主层形状错误：统一返回 E-PAYLOAD，不抛、不改状态。 */
function payloadFailure(message: string, path: string): SourceHostResult {
  return { ok: false, diagnostics: [makeDiagnostic("E-PAYLOAD", message, { path })] };
}

/** 稳定文本序：注册表序列化、级联记录都靠它得到与到达顺序无关的结果。 */
function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function compareDropped(left: DroppedSource, right: DroppedSource): number {
  return compareText(left.owner, right.owner) || compareText(left.mountAt, right.mountAt);
}

/** 注册表里全部局部树的棵数（级联轮数上界）。 */
function countTrees(registry: ReadonlyMap<string, readonly LocalTree[]>): number {
  let total = 0;
  for (const trees of registry.values()) {
    total += trees.length;
  }
  return total;
}

/**
 * 撤掉 mountAt 落在死引用 slot 集合里的树；同一来源的其他树保留。
 * 返回撤掉的棵数（0 表示死引用诊断与注册表对不上，调用方按普通失败回滚）。
 */
function dropTreesAt(
  registry: Map<string, LocalTree[]>,
  missingSlots: ReadonlySet<string>,
  dropped: DroppedSource[],
): number {
  let removed = 0;
  for (const [owner, trees] of registry) {
    const live: LocalTree[] = [];
    for (const tree of trees) {
      if (missingSlots.has(tree.mountAt)) {
        dropped.push({ owner, mountAt: tree.mountAt });
        removed += 1;
      } else {
        live.push(tree);
      }
    }
    if (live.length === 0) {
      registry.delete(owner);
    } else {
      registry.set(owner, live);
    }
  }
  return removed;
}

/**
 * 来源宿主：登记 / 替换 / 撤销来源的局部树，重算权威根树。
 *
 * 用法：
 * ```ts
 * const host = new SourceHost();
 * host.register("ideas", [pageTree]);          // 成功：tree 里出现 pageTree
 * host.register("audio", [cardTree]);          // 失败：只回诊断，registry / tree 不变
 * host.remove("ideas");                        // 挂 ideas.feed 的贡献级联撤掉
 * host.load(payloadTrees);                     // 线上全量负载：整组替换注册表
 * host.dispose();                              // 账本收口，之后操作一律拒绝
 * ```
 */
export class SourceHost {
  private current: SlotNode;
  private readonly base: SlotNode;
  private readonly ledger: LifecycleLedger;
  private readonly requesterFor: ((tree: LocalTree) => Requester) | undefined;
  private registry = new Map<string, LocalTree[]>();
  private seq = 1;
  private isDisposed = false;

  constructor(options: SourceHostOptions = {}) {
    this.base = options.base ?? WINDOW_SCAFFOLD;
    this.current = this.base;
    this.ledger = options.ledger ?? new LifecycleLedger();
    this.requesterFor = options.requesterFor;
  }

  /** 当前权威根树；未注册来源时就是 base。只读，调用方不得原地改写。 */
  get tree(): SlotNode {
    return this.current;
  }

  /** 注册表快照：owner → 局部树数组拷贝（owner 按名字排序）；改返回值不影响宿主。 */
  get sources(): ReadonlyMap<string, readonly LocalTree[]> {
    const snapshot = new Map<string, readonly LocalTree[]>();
    for (const owner of [...this.registry.keys()].sort(compareText)) {
      snapshot.set(owner, [...(this.registry.get(owner) ?? [])]);
    }
    return snapshot;
  }

  /** 已注册的来源数。 */
  get size(): number {
    return this.registry.size;
  }

  /**
   * 登记 / 替换一个来源的局部树：成功提交新根树；失败时 registry 与根树原样保留。
   *
   * 校验只做宿主自己的那一层（owner 非空、每棵树 owner 与参数一致）；树形状 / 落点 /
   * 顺序 / 容量 / 环交给链接器，诊断原样带回。trees 为数组拷贝，调用方之后改数组参数
   * 不影响注册表（树对象本身不深拷，见文件头边界）。
   */
  register(owner: string, trees: readonly LocalTree[]): SourceHostResult {
    if (this.isDisposed) {
      return disposedFailure();
    }
    const ownerDiagnostic = validateOwner(owner);
    if (ownerDiagnostic !== undefined) {
      return { ok: false, diagnostics: [ownerDiagnostic] };
    }
    if (!isObjectArray(trees)) {
      return {
        ok: false,
        diagnostics: [
          makeDiagnostic("E-PAYLOAD", "trees 必须是局部树数组", { owner, path: "$.trees" }),
        ],
      };
    }
    for (const [index, tree] of trees.entries()) {
      if (!isObject(tree)) {
        return {
          ok: false,
          diagnostics: [
            makeDiagnostic("E-PAYLOAD", "局部树必须是对象", {
              owner,
              path: `$.trees[${String(index)}]`,
            }),
          ],
        };
      }
      if (tree.owner !== owner) {
        return {
          ok: false,
          diagnostics: [
            makeDiagnostic(
              "E-PAYLOAD",
              `局部树 owner 必须等于来源 owner（${owner}），实际是 ${String(tree.owner)}`,
              { owner, slot: tree.mountAt, path: `$.trees[${String(index)}].owner` },
            ),
          ],
        };
      }
    }

    const candidate = new Map(this.registry);
    candidate.set(owner, [...trees]);
    const linked = this.relink(candidate);
    if (!linked.ok) {
      return linked;
    }
    this.commit(candidate, linked.tree);
    return { ok: true, tree: this.current, diagnostics: [], dropped: [] };
  }

  /**
   * 用给定局部树整组替换注册表（线上 `local-trees` 全量负载的宿主入口）：先按
   * `tree.owner` 分组校验，再只重链接一次；成功才提交新 registry 与根树，失败时两者
   * 保持操作前的样子（fail closed，只回诊断）。允许空数组（清空来源，树回到 base）；
   * 跨 owner 依赖（B 的树挂进 A 树声明的 slot）也在这同一次链接里落成。
   *
   * 只做宿主这层校验（trees 是数组、每棵是对象且 owner 非空）；树形状 / 落点 / 顺序 /
   * 容量 / 环 / 权限交给链接器。参数按 owner 分组拷进注册表，之后改数组参数不影响宿主
   * （树对象本身不深拷，见文件头边界）。
   */
  load(trees: readonly LocalTree[]): SourceHostResult {
    if (this.isDisposed) {
      return disposedFailure();
    }
    if (!isObjectArray(trees)) {
      return payloadFailure("trees 必须是局部树数组", "$.trees");
    }
    const candidate = new Map<string, LocalTree[]>();
    for (const [index, tree] of trees.entries()) {
      const path = `$.trees[${String(index)}]`;
      if (!isObject(tree)) {
        return payloadFailure("局部树必须是对象", path);
      }
      const ownerDiagnostic = validateOwner(tree.owner, path + ".owner");
      if (ownerDiagnostic !== undefined) {
        return { ok: false, diagnostics: [ownerDiagnostic] };
      }
      const group = candidate.get(tree.owner) ?? [];
      group.push(tree);
      candidate.set(tree.owner, group);
    }
    const linked = this.relink(candidate);
    if (!linked.ok) {
      return linked;
    }
    this.commit(candidate, linked.tree);
    return { ok: true, tree: this.current, diagnostics: [], dropped: [] };
  }

  /**
   * 撤销一个来源：先撤来源本身，再按 composition.md §7 级联撤掉失去落点的树。
   *
   * 每轮重链接一次：失败且只含死引用（E-TARGET-MISSING）时，把 mountAt 落在缺失 slot
   * 上的树撤掉、记一条 dropped 与诊断，再重链；其余错误（歧义 / 容量 / 环 / 形状）靠
   * 丢树修不好，整次 remove 回滚并原样返回诊断。成功时 registry 才提交。
   */
  remove(owner: string): SourceHostResult {
    if (this.isDisposed) {
      return disposedFailure();
    }
    const ownerDiagnostic = validateOwner(owner);
    if (ownerDiagnostic !== undefined) {
      return { ok: false, diagnostics: [ownerDiagnostic] };
    }
    if (!this.registry.has(owner)) {
      return { ok: true, tree: this.current, diagnostics: [], dropped: [] };
    }

    const candidate = new Map(this.registry);
    candidate.delete(owner);
    const dropped: DroppedSource[] = [];
    const deadDiagnostics: Diagnostic[] = [];
    const totalTrees = countTrees(this.registry);
    for (let round = 0; round <= totalTrees; round += 1) {
      const linked = this.relink(candidate);
      if (linked.ok) {
        this.commit(candidate, linked.tree);
        dropped.sort(compareDropped);
        return {
          ok: true,
          tree: this.current,
          diagnostics: sortDiagnostics(deadDiagnostics),
          dropped,
        };
      }
      const missing = linked.diagnostics.filter(
        (diagnostic) => diagnostic.code === "E-TARGET-MISSING",
      );
      if (missing.length === 0) {
        // 非死引用错误：丢树修不好，整次 remove 回滚。
        return linked;
      }
      const missingSlots = new Set<string>();
      for (const diagnostic of missing) {
        if (diagnostic.slot !== undefined) {
          missingSlots.add(diagnostic.slot);
        }
      }
      const removed = dropTreesAt(candidate, missingSlots, dropped);
      if (removed === 0) {
        // 死引用诊断找不到对应注册树（链接器与注册表对不上）：按普通失败整体回滚。
        return linked;
      }
      deadDiagnostics.push(...missing);
    }
    // 每轮至少撤掉一棵树，轮数上界是注册树总数；正常到不了这里，防御不死循环。
    return {
      ok: false,
      diagnostics: [makeDiagnostic("E-PAYLOAD", "级联超过注册树数上限，已回滚", { path: "$" })],
    };
  }

  /**
   * 卸载：账本整本收口（逆序撤销登记，失败隔离由账本负责）；幂等。
   * 之后 register / remove / load 一律 E-PAYLOAD 失败；registry 与根树保留供检查，不再变。
   */
  dispose(): DisposeReport {
    if (this.isDisposed) {
      return { disposed: 0, errors: [] };
    }
    this.isDisposed = true;
    return this.ledger.disposeAll();
  }

  /** 提交一次成功链接：换注册表与当前根树（调用前已确认链接成功）。 */
  private commit(registry: Map<string, LocalTree[]>, tree: SlotNode): void {
    this.registry = registry;
    this.current = tree;
  }

  /**
   * 把候选注册表拼成 local-trees payload 交给链接器，不改 registry 与当前树。
   * owner 排序让 payload 顺序与注册顺序无关；配了 requesterFor 就透传给链接器。
   */
  private relink(registry: ReadonlyMap<string, readonly LocalTree[]>): LinkResult {
    const trees: LocalTree[] = [];
    for (const owner of [...registry.keys()].sort(compareText)) {
      trees.push(...(registry.get(owner) ?? []));
    }
    const payload: LocalTreesPayload = { kind: "local-trees", seq: this.seq, trees };
    this.seq += 1;
    if (this.requesterFor === undefined) {
      return link(this.base, payload);
    }
    return link(this.base, payload, { requesterFor: this.requesterFor });
  }
}
