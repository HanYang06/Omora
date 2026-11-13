/**
 * 链接期编译器（第二遍）：把多棵局部树挂进窗口骨架，得到唯一权威根树。
 *
 * 纯函数：不改进参。有 error 诊断就不产树（原子）。多轮解析：落点可能由另一棵
 * 局部树引入；排序与去重只依赖声明内容，与到达顺序无关。
 *
 * 链接期权限（S4）：attach 前逐棵检查目标 slot 的 `mount` / `replace` 能力
 * （`permissions.md` §4「组合/链接期」）；越权 → `E-PERMISSION`，整次链接失败、
 * 不产树。默认无 options = 系统来源，现有 fixture 与构建门禁行为不变。
 *
 * 检查器复用 `runtime/permissions.ts` 的 `can` / `SYSTEM_REQUESTER`，grant token
 * 求值只有一份实现，不在 link 里复制。runtime 对 link 的依赖只有 `link/types.ts`
 * 且全是 `import type`（编译期擦除），所以 link 反向 import 运行期模块不构成 ESM
 * 模块环；`Requester` 形状另定义在 `link/types.ts`，与 runtime 的同名接口结构一致。
 */

import type { Capacity, SlotNode } from "../contract/document";
import { can, SYSTEM_REQUESTER, type Capability } from "../runtime/permissions";
import { collectIds, makeDiagnostic, parseLocalTrees, sortDiagnostics } from "./parse";
import {
  assignDepths,
  compareText,
  indexInto,
  indexNode,
  unindex,
  normalizeRoot,
} from "./tree_index";
import type {
  Diagnostic,
  LinkOptions,
  LinkResult,
  LocalTree,
  LocalTreesPayload,
  Requester,
} from "./types";

interface Mount {
  tree: LocalTree;
}

function failure(diagnostics: Diagnostic[]): LinkResult {
  return { ok: false, diagnostics: sortDiagnostics(diagnostics) };
}

function compareMounts(left: Mount, right: Mount): number {
  const byOrder = left.tree.order - right.tree.order;
  if (byOrder !== 0) {
    return byOrder;
  }
  const byOwner = compareText(left.tree.owner, right.tree.owner);
  if (byOwner !== 0) {
    return byOwner;
  }
  const bySeq = left.tree.seq - right.tree.seq;
  if (bySeq !== 0) {
    return bySeq;
  }
  return compareText(left.tree.root.id, right.tree.root.id);
}

/**
 * 链接：先校验形状（payload + base），再跨树链接；失败只回诊断。
 *
 * `options.requesterFor` 不给 = 系统来源，行为与 S2 完全一致（全放行）。
 */
export function link(base: SlotNode, payload: unknown, options: LinkOptions = {}): LinkResult {
  const normalized = normalizeRoot(base, "$.base");
  if (!normalized.ok) {
    return { ok: false, diagnostics: [normalized.diagnostic] };
  }
  const parsed = parseLocalTrees(payload);
  if (!parsed.ok) {
    return { ok: false, diagnostics: parsed.diagnostics };
  }
  return linkParsed(normalized.root, parsed.payload, options);
}

function linkParsed(base: SlotNode, payload: LocalTreesPayload, options: LinkOptions): LinkResult {
  const diagnostics: Diagnostic[] = [];
  const trees = payload.trees;
  const tree = structuredClone(base);
  const workingIndex = indexInto(tree);

  // 全局 id 唯一：base 的 id 与局部树 id 冲突也算重复。
  const treeIdOwners = new Map<string, number>();
  trees.forEach((localTree, index) => {
    for (const located of collectIds(localTree.root)) {
      if (workingIndex.has(located.id)) {
        diagnostics.push(
          makeDiagnostic("E-ID-DUPLICATE", `重复 id: ${located.id}（base 与 ${localTree.owner}）`, {
            owner: localTree.owner,
            slot: localTree.mountAt,
          }),
        );
        continue;
      }
      treeIdOwners.set(located.id, index);
    }
  });
  if (diagnostics.length > 0) {
    return failure(diagnostics);
  }

  // 落点归属：base / 另一棵局部树 / 缺失 / 自环。
  const mountedAtBase = new Array<boolean>(trees.length).fill(false);
  const selfCycled = new Array<boolean>(trees.length).fill(false);
  const missingTarget = new Array<boolean>(trees.length).fill(false);
  const parentOf = new Array<number | undefined>(trees.length).fill(undefined);
  trees.forEach((localTree, index) => {
    if (workingIndex.has(localTree.mountAt)) {
      mountedAtBase[index] = true;
      return;
    }
    const targetOwner = treeIdOwners.get(localTree.mountAt);
    if (targetOwner === undefined) {
      missingTarget[index] = true;
      return;
    }
    if (targetOwner === index) {
      selfCycled[index] = true;
      return;
    }
    parentOf[index] = targetOwner;
  });

  // 局部树之间的依赖成环（DFS 三色）。
  const colors = new Array<number>(trees.length).fill(0);
  const cycles = new Set<number>();
  const stack: number[] = [];
  const visit = (index: number): void => {
    const color = colors[index] ?? 0;
    if (color === 2) {
      return;
    }
    if (color === 1) {
      const start = stack.indexOf(index);
      for (const member of stack.slice(start === -1 ? 0 : start)) {
        cycles.add(member);
      }
      return;
    }
    colors[index] = 1;
    stack.push(index);
    const parent = parentOf[index];
    if (parent !== undefined) {
      visit(parent);
    }
    stack.pop();
    colors[index] = 2;
  };
  trees.forEach((_localTree, index) => {
    visit(index);
  });

  // 能从 base 逐轮挂上的树才算 rooted；成环与死引用都落不下。
  const rootedMemo = new Map<number, boolean>();
  const isRooted = (index: number): boolean => {
    const cached = rootedMemo.get(index);
    if (cached !== undefined) {
      return cached;
    }
    if (mountedAtBase[index] === true) {
      rootedMemo.set(index, true);
      return true;
    }
    if (cycles.has(index) || selfCycled[index] === true || missingTarget[index] === true) {
      rootedMemo.set(index, false);
      return false;
    }
    const parent = parentOf[index];
    const rooted = parent !== undefined && isRooted(parent);
    rootedMemo.set(index, rooted);
    return rooted;
  };

  trees.forEach((localTree, index) => {
    if (selfCycled[index] === true) {
      diagnostics.push(
        makeDiagnostic("E-CYCLE", `局部树挂在自己子树里的 slot 上: ${localTree.mountAt}`, {
          owner: localTree.owner,
          slot: localTree.mountAt,
        }),
      );
      return;
    }
    if (cycles.has(index)) {
      diagnostics.push(
        makeDiagnostic("E-CYCLE", `局部树之间依赖成环: ${localTree.mountAt}`, {
          owner: localTree.owner,
          slot: localTree.mountAt,
        }),
      );
      return;
    }
    if (!isRooted(index)) {
      const message =
        missingTarget[index] === true
          ? `落点不存在: ${localTree.mountAt}`
          : `多轮链接后落点仍不存在: ${localTree.mountAt}`;
      diagnostics.push(
        makeDiagnostic("E-TARGET-MISSING", message, {
          owner: localTree.owner,
          slot: localTree.mountAt,
        }),
      );
    }
  });

  // 同 slot 分组：order 决定跨 owner 顺序，seq 决定同 owner 顺序。
  const mountsBySlot = new Map<string, Mount[]>();
  trees.forEach((localTree, index) => {
    if (!isRooted(index)) {
      return;
    }
    const mounts = mountsBySlot.get(localTree.mountAt) ?? [];
    mounts.push({ tree: localTree });
    mountsBySlot.set(localTree.mountAt, mounts);
  });
  for (const [slot, mounts] of mountsBySlot) {
    const byOrder = new Map<number, Mount[]>();
    for (const mount of mounts) {
      const group = byOrder.get(mount.tree.order) ?? [];
      group.push(mount);
      byOrder.set(mount.tree.order, group);
    }
    for (const [order, group] of byOrder) {
      const owners = [...new Set(group.map((mount) => mount.tree.owner))].sort();
      if (owners.length > 1) {
        const first = owners[0] ?? "";
        const second = owners[1] ?? "";
        diagnostics.push(
          makeDiagnostic(
            "E-SLOT-AMBIGUOUS",
            `同 slot ${slot} 上 owner ${first} 与 ${second} 的挂载 order 都是 ${String(order)}，顺序无法确定`,
            { owner: first, slot },
          ),
        );
      }
    }
    const replaced = mounts.filter((mount) => mount.tree.replace);
    if (replaced.length > 0 && mounts.length > 1) {
      diagnostics.push(
        makeDiagnostic(
          "E-SLOT-CAPACITY",
          `slot ${slot} 的 replace 挂载必须独占该 slot，不能与其他挂载共存`,
          { slot },
        ),
      );
    }
    mounts.sort(compareMounts);
  }
  if (diagnostics.length > 0) {
    return failure(diagnostics);
  }

  // 目标深度：决定了挂载顺序（父树先挂，子树目标才存在）。
  const depths = new Map<string, number>();
  assignDepths(tree, 0, depths);
  const resolvedTrees = new Set<number>();
  const resolveDepths = (index: number): void => {
    if (resolvedTrees.has(index)) {
      return;
    }
    resolvedTrees.add(index);
    const localTree = trees[index];
    if (localTree === undefined) {
      return;
    }
    const parent = parentOf[index];
    if (parent !== undefined) {
      resolveDepths(parent);
    }
    const targetDepth = depths.get(localTree.mountAt);
    if (targetDepth === undefined) {
      return;
    }
    assignDepths(localTree.root, targetDepth + 1, depths);
  };
  trees.forEach((_localTree, index) => {
    if (isRooted(index)) {
      resolveDepths(index);
    }
  });

  /**
   * 链接期权限检查：replace 挂载要目标 slot 的 replace 能力，普通挂载要 mount。
   *
   * 检查器复用 runtime/permissions 的 `can`（grant token 求值只有一份实现），这里
   * 只挑检查对象、造 E-PERMISSION 诊断：现场 owner 记局部树 owner，slot 记 mountAt。
   * 返回 true = 本槽有越权挂载，整次链接必须失败。
   */
  const checkMountPermissions = (target: SlotNode, mounts: readonly Mount[]): boolean => {
    let denied = false;
    for (const mount of mounts) {
      const capability: Capability = mount.tree.replace ? "replace" : "mount";
      const requester: Requester = options.requesterFor?.(mount.tree) ?? SYSTEM_REQUESTER;
      if (can(target, capability, requester)) {
        continue;
      }
      denied = true;
      diagnostics.push(
        makeDiagnostic(
          "E-PERMISSION",
          `来源 ${mount.tree.owner} 没有 slot ${target.id} 的 ${capability} 能力（requester ${requester.owner}）`,
          { owner: mount.tree.owner, slot: mount.tree.mountAt },
        ),
      );
    }
    return denied;
  };

  const attachedSlots = new Set<string>();
  /** attach 一个槽；返回 true = 权限拒绝，调用方立即让整次链接失败。 */
  const attachSlot = (slot: string): boolean => {
    if (attachedSlots.has(slot)) {
      return false;
    }
    attachedSlots.add(slot);
    const mounts = mountsBySlot.get(slot);
    if (mounts === undefined) {
      return false;
    }
    const target = workingIndex.get(slot);
    if (target === undefined) {
      diagnostics.push(makeDiagnostic("E-TARGET-MISSING", `落点不存在: ${slot}`, { slot }));
      return false;
    }
    // 权限在结构检查（落点/歧义/replace 独占）之后、改树之前：越权整次链接失败。
    if (checkMountPermissions(target, mounts)) {
      return true;
    }
    const replacement = mounts.find((mount) => mount.tree.replace);
    if (replacement !== undefined) {
      for (const child of target.children) {
        unindex(child, workingIndex);
      }
      target.children = [structuredClone(replacement.tree.root)];
      const replacementRoot = target.children[0];
      if (replacementRoot !== undefined) {
        indexNode(replacementRoot, workingIndex);
      }
      return false;
    }
    for (const mount of mounts) {
      const root = structuredClone(mount.tree.root);
      target.children.push(root);
      indexNode(root, workingIndex);
    }
    return false;
  };
  const slotOrder = [...mountsBySlot.keys()].sort((left, right) => {
    const byDepth = (depths.get(left) ?? 0) - (depths.get(right) ?? 0);
    return byDepth !== 0 ? byDepth : compareText(left, right);
  });
  for (const slot of slotOrder) {
    // 越权立即失败：父槽没挂上会派生出依赖它的 E-TARGET-MISSING 噪声。
    if (attachSlot(slot)) {
      return failure(diagnostics);
    }
  }
  if (diagnostics.length > 0) {
    return failure(diagnostics);
  }

  checkCapacities(tree, diagnostics);
  if (diagnostics.length > 0) {
    return failure(diagnostics);
  }
  return { ok: true, tree, ids: indexInto(tree) };
}

function checkCapacities(root: SlotNode, diagnostics: Diagnostic[]): void {
  const visit = (node: SlotNode): void => {
    const capacity: Capacity | undefined = node.layout?.capacity;
    if (capacity !== undefined) {
      const count = node.children.length;
      const violates = (capacity === "none" && count > 0) || (capacity === "one" && count > 1);
      if (violates) {
        diagnostics.push(
          makeDiagnostic(
            "E-SLOT-CAPACITY",
            `slot ${node.id} 的 capacity 是 ${capacity}，链接后有 ${String(count)} 个子节点`,
            { owner: node.owner, slot: node.id },
          ),
        );
      }
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  visit(root);
}
