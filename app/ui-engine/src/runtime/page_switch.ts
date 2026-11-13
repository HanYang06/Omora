/**
 * Dendrolink 换页协调（S3-d）：按 id 给旧页子树与新页子树分类。
 *
 * 语义依据 docs/engine/structure.md §5「页面切换 = 按 id 协调」：换页是页面槽位的
 * 子树替换 + 一条 route 意图，协调按 id 做，而不是整页重建。
 *
 * 分类规则（任务固定）：
 * - 同 id、同父、同序号 → keep（复用实例，局部状态保留）；
 * - 同 id、换父或换序号 → move（实例保留，索引更新）；
 * - 同父、同序号，旧 id 与新 id 不同 → replace（旧子树卸载、新子树挂载）；
 * - 只在旧树 → cancel（撤订阅、跑清理）；只在新树 → add（挂载、订阅）。
 *
 * 实现边界（写清楚，避免调用方误用）：
 * - 只看 live 子树：沿 children 递归。collection.templates 是命名模板、不挂载，
 *   不参与 diff——模板 id 不进任何分类，也不会被当成 live 节点参与同 id 配对。
 * - 「序号」= 节点在父 children 数组里的下标；Slot 没有显式 order 字段。
 * - 先按 id 配对：两棵树各按文档序（pre-order）取第一个尚未配对的同 id 节点。
 *   配对成功后才比（父 id, 序号）：都相同是 keep，否则是 move。
 * - replace 只发生在「两边都没配上对」的节点之间（它们本来会分别落进 add /
 *   cancel），只有同一（父 id, 序号）且 id 不同才合成一对。已配对节点不会同时
 *   出现在 replace 与 keep / move 里：一个旧节点被配对到别处（move）时，占了它
 *   旧位置的新节点只是 add——旧实例并没有卸载。
 * - 根：previous 非 null 时，根 id 相同 → keep；根 id 不同 → replace
 *   { from 旧根, to 新根 }，根不进 add / cancel。根以下仍逐节点按 id / 父 / 序号
 *   分类，所以根替换时同 id 但父变了的后代是 move（实例保留），不是 keep。
 *   previous 为 null 时新树整棵按 pre-order（含根）进 add。
 * - 重复 id 防御：parseDocument 会拒绝重复 id，本函数不假设入参已校验。文档序
 *   先到先得——旧树每个节点最多配对一次；新树里重复的同 id 节点找不到未配对旧
 *   节点时按 replace / add 规则处理，不抛。
 * - 每个 live 节点恰好出现在一个分类里：旧树 = keep ∪ move ∪ cancel ∪
 *   replace.from，新树 = keep ∪ move ∪ add ∪ replace.to（重复 id 时按节点个数，
 *   列表里 id 可能重复）。
 * - 数组顺序确定：keep / move / add 按新树 pre-order；replace 按 to 节点的新树
 *   pre-order；cancel 按旧树 pre-order。同输入永远同输出。
 * - 纯函数：不碰 DOM、不改入参、不缓存状态。
 *
 * 例：旧页 [A, B]，新页 [A, C] → keep [A]；B 与 C 同父同序号 →
 * replace [{ from: B, to: C }]；cancel / add 为空。
 */

import type { SlotNode } from "../contract/document";

/** 换页协调计划：给渲染协调器按 id 执行保留 / 移动 / 替换 / 取消 / 新增。 */
export interface PageSwitchPlan {
  /** 同 id、同父、同序号：复用实例，局部状态保留。 */
  keep: string[];
  /** 同 id、换父或换序号：复用实例，索引更新。 */
  move: string[];
  /** 同父同序号换 id：先卸载旧子树再挂载新子树。 */
  replace: { from: string; to: string }[];
  /** 只在旧树：卸载、撤订阅、跑清理。 */
  cancel: string[];
  /** 只在新树：挂载、订阅、取数据。 */
  add: string[];
}

/** 节点在树里的位置：父 id（根为 null）与它在父 children 里的下标。 */
interface Located {
  node: SlotNode;
  parentId: string | null;
  order: number;
}

/** 按 pre-order 收集 live 节点；只走 children，不进 collection.templates。 */
function flattenLive(root: SlotNode): Located[] {
  const out: Located[] = [];
  const walk = (node: SlotNode, parentId: string | null, order: number): void => {
    out.push({ node, parentId, order });
    node.children.forEach((child, index) => {
      walk(child, node.id, index);
    });
  };
  walk(root, null, 0);
  return out;
}

function samePlace(left: Located, right: Located): boolean {
  return left.parentId === right.parentId && left.order === right.order;
}

/**
 * 取同 id 队列里第一个未配对的旧节点下标。
 *
 * 队列按旧树文档序；根可能已被根配对消耗，所以先跳过已配对项。
 */
function takeUnmatched(
  queue: number[] | undefined,
  matched: readonly boolean[],
): number | undefined {
  if (queue === undefined) {
    return undefined;
  }
  while (queue.length > 0) {
    const index = queue.shift();
    if (index === undefined) {
      return undefined;
    }
    if (matched[index] !== true) {
      return index;
    }
  }
  return undefined;
}

/**
 * 按 id 比较两棵页子树，给出渲染协调计划（语义见文件头）。
 *
 * `previous` 为 null 表示首次进页：新树整棵进 add。
 */
export function diffPageTrees(previous: SlotNode | null, next: SlotNode): PageSwitchPlan {
  const plan: PageSwitchPlan = { keep: [], move: [], replace: [], cancel: [], add: [] };
  const newEntries = flattenLive(next);
  if (previous === null) {
    plan.add = newEntries.map((entry) => entry.node.id);
    return plan;
  }
  const oldEntries = flattenLive(previous);
  const oldRoot = oldEntries[0];
  const newRoot = newEntries[0];
  if (oldRoot === undefined || newRoot === undefined) {
    // flattenLive 至少返回根节点；走到这里说明入参不是合法的 SlotNode 树。
    throw new Error("diffPageTrees 需要至少包含根节点的 SlotNode 树");
  }

  const oldMatched = oldEntries.map(() => false);
  const newMatched = newEntries.map(() => false);
  const oldQueues = new Map<string, number[]>();
  for (const [index, entry] of oldEntries.entries()) {
    const queue = oldQueues.get(entry.node.id);
    if (queue === undefined) {
      oldQueues.set(entry.node.id, [index]);
      continue;
    }
    queue.push(index);
  }

  // 根的位置固定（parent = null），只可能是 keep 或 replace。
  oldMatched[0] = true;
  newMatched[0] = true;
  if (oldRoot.node.id === newRoot.node.id) {
    plan.keep.push(newRoot.node.id);
  } else {
    plan.replace.push({ from: oldRoot.node.id, to: newRoot.node.id });
  }

  // 非根节点先按 id 配对，再比（父 id, 序号）；未配对的留到后面判 replace / add。
  for (const [index, entry] of newEntries.entries()) {
    if (newMatched[index] === true) {
      continue;
    }
    const matchedIndex = takeUnmatched(oldQueues.get(entry.node.id), oldMatched);
    if (matchedIndex === undefined) {
      continue;
    }
    const oldEntry = oldEntries[matchedIndex];
    if (oldEntry === undefined) {
      throw new Error("旧节点下标越界: " + String(matchedIndex));
    }
    oldMatched[matchedIndex] = true;
    newMatched[index] = true;
    if (samePlace(oldEntry, entry)) {
      plan.keep.push(entry.node.id);
    } else {
      plan.move.push(entry.node.id);
    }
  }

  // 未配对旧节点按（父 id, 序号）建索引；重复 id 防御时旧树文档序先到先得。
  const oldByPlace = new Map<string | null, Map<number, number>>();
  for (const [index, entry] of oldEntries.entries()) {
    if (oldMatched[index] === true) {
      continue;
    }
    let byOrder = oldByPlace.get(entry.parentId);
    if (byOrder === undefined) {
      byOrder = new Map<number, number>();
      oldByPlace.set(entry.parentId, byOrder);
    }
    if (!byOrder.has(entry.order)) {
      byOrder.set(entry.order, index);
    }
  }

  // 未配对新节点：同（父 id, 序号）还有未配对旧节点且 id 不同 → replace，否则 add。
  for (const [index, entry] of newEntries.entries()) {
    if (newMatched[index] === true) {
      continue;
    }
    const byOrder = oldByPlace.get(entry.parentId);
    const oldIndex = byOrder?.get(entry.order);
    if (byOrder !== undefined && oldIndex !== undefined) {
      const oldEntry = oldEntries[oldIndex];
      if (oldEntry !== undefined && oldEntry.node.id !== entry.node.id) {
        byOrder.delete(entry.order);
        oldMatched[oldIndex] = true;
        plan.replace.push({ from: oldEntry.node.id, to: entry.node.id });
        continue;
      }
    }
    plan.add.push(entry.node.id);
  }

  // 没被 replace 用掉的旧节点 → cancel（旧树 pre-order）。
  for (const [index, entry] of oldEntries.entries()) {
    if (oldMatched[index] !== true) {
      plan.cancel.push(entry.node.id);
    }
  }

  return plan;
}
