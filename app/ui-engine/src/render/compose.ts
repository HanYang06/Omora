import type { Node } from "../core/types";

/**
 * 组合器：把若干份贡献挂到根树的键上，产出一棵新树和一个 key → 节点 的索引。
 * 当前实现是 legacy 贡献模型；目标契约见 docs/engine/composition.md。
 *
 * 纯函数：入参不改；产出的新树里，没被碰到过的子树仍是入参里的原对象
 * （渲染端按节点引用 memo，补丁也靠它）。
 *
 * replace 之后键留在原处（由引擎打在替换树根上），所以同一个键可以被
 * 后来的 replace 接着覆盖，覆盖链才接得下去。
 */
export interface Contribution {
  owner: string;
  target: string;
  op: "replace" | "before" | "after" | "append";
  order?: number;
  seq?: number;
  tree: Node;
}

export interface ComposeResult {
  tree: Node;
  /** key → 节点，供替换、卸载、调试用。 */
  index: ReadonlyMap<string, Node>;
}

/**
 * 编辑期的节点：node 还是原对象，children 是平行的帧数组。
 * 组装的整个过程只改帧，不碰任何入参节点的 children / props。
 */
interface Frame {
  node: Node;
  children: Frame[];
  parent: Frame | null;
}

/** 键 = 节点 props.key 里的非空字符串；别的形状不算键，不能被别的贡献瞄准。 */
function keyOf(node: Node): string | undefined {
  const key = node.props.key;
  return typeof key === "string" && key.length > 0 ? key : undefined;
}

function frameOf(node: Node, parent: Frame | null): Frame {
  const frame: Frame = { node, children: [], parent };
  frame.children = node.children.map((child) => frameOf(child, frame));
  return frame;
}

/**
 * 收尾：把帧还原成节点。children 与原始节点逐个引用相同就返回原节点，
 * 所以没被碰到的子树天然保持引用相等；改过的路径逐层重建。
 */
function freeze(frame: Frame): Node {
  const children = frame.children.map(freeze);
  const untouched =
    children.length === frame.node.children.length &&
    children.every((child, at) => child === frame.node.children[at]);
  if (untouched) {
    return frame.node;
  }
  return { type: frame.node.type, props: frame.node.props, children };
}

/** 贡献自己的树里有没有这个键：有就说明这次挂接会成环。 */
function declaresKey(node: Node, key: string): boolean {
  if (keyOf(node) === key) {
    return true;
  }
  return node.children.some((child) => declaresKey(child, key));
}

/**
 * 只看根以下的子孙。replace 的根键由引擎打（见 stampKey），所以根这一层
 * 不参与成环判断；子孙里再出现目标键仍然是环。
 */
function declaresKeyBelowRoot(node: Node, key: string): boolean {
  return node.children.some((child) => declaresKey(child, key));
}

/**
 * replace 之后键必须还在：替换树的根一律打上目标键，覆盖链才接得下去。
 * 替换树根自带别的键时警告并强制改名（键是落点契约，不是树作者的装饰）。
 * 只重建根这一层，children 仍是原来的引用，入参树不改。
 */
function stampKey(tree: Node, key: string, owner: string): Node {
  const declared = keyOf(tree);
  if (declared === key) {
    return tree;
  }
  if (declared !== undefined) {
    console.warn(`[compose] 替换树根自带键 ${declared}：owner=${owner} 强制改成 target=${key}`);
  }
  return { type: tree.type, props: { ...tree.props, key }, children: tree.children };
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/**
 * 全序 (order ?? 0, owner, seq ?? 0)；再按 target / op 兜底。
 * 三段都相同时按 target / op 排，只为让结果与输入的到达顺序无关。
 */
function compareContributions(left: Contribution, right: Contribution): number {
  const byOrder = (left.order ?? 0) - (right.order ?? 0);
  if (byOrder !== 0) {
    return byOrder;
  }
  const byOwner = compareStrings(left.owner, right.owner);
  if (byOwner !== 0) {
    return byOwner;
  }
  const bySeq = (left.seq ?? 0) - (right.seq ?? 0);
  if (bySeq !== 0) {
    return bySeq;
  }
  const byTarget = compareStrings(left.target, right.target);
  if (byTarget !== 0) {
    return byTarget;
  }
  return compareStrings(left.op, right.op);
}

function prepare(contributions: readonly Contribution[]): Contribution[] {
  // 同一 (owner, target, op, seq) 重复到达时后者替换前者（幂等）：保留同一键的最后一份。
  // seq 参与去重，是因为同一个插件可以往同一个键交多份（docs §3），靠声明序号区分；
  // 连 seq 都一样的才是一份贡献重复到达。
  const latest = new Map<string, Contribution>();
  for (const contribution of contributions) {
    const dedupeKey = `${contribution.owner}\u0000${contribution.target}\u0000${contribution.op}\u0000${contribution.seq ?? 0}`;
    latest.set(dedupeKey, contribution);
  }

  const prepared: Contribution[] = [];
  for (const contribution of latest.values()) {
    // 先查目标键是否在自己树里，再交给 apply 打键；replace 的根键由引擎打，只看子孙。
    const cyclic =
      contribution.op === "replace"
        ? declaresKeyBelowRoot(contribution.tree, contribution.target)
        : declaresKey(contribution.tree, contribution.target);
    if (cyclic) {
      console.warn(
        `[compose] 拒绝成环贡献：owner=${contribution.owner} target=${contribution.target} op=${contribution.op}（目标在贡献自己的树里）`,
      );
      continue;
    }
    prepared.push(contribution);
  }
  prepared.sort(compareContributions);
  return prepared;
}

/** 当前树里的键 → 帧；同一个键出现多次时取文档顺序上的第一个。 */
function frameIndex(root: Frame): Map<string, Frame> {
  const index = new Map<string, Frame>();
  const visit = (frame: Frame): void => {
    const key = keyOf(frame.node);
    if (key !== undefined && !index.has(key)) {
      index.set(key, frame);
    }
    for (const child of frame.children) {
      visit(child);
    }
  };
  visit(root);
  return index;
}

/** 最终树里的键 → 节点；同一个键出现多次时取文档顺序上的第一个。 */
function nodeIndex(root: Node): Map<string, Node> {
  const index = new Map<string, Node>();
  const visit = (node: Node): void => {
    const key = keyOf(node);
    if (key !== undefined && !index.has(key)) {
      index.set(key, node);
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  visit(root);
  return index;
}

/**
 * 把一份贡献挂到帧树上。落点没法挂（根节点没有兄弟、after 的锚点被换掉）
 * 返回 null，交给调用方当死键处理。
 *
 * after 用"已插入的最后一个兄弟"当锚点：同一落点上的多份 after 按全序
 * 依次排在后面，文档顺序与排序一致；否则每份都紧跟目标插入，顺序会反过来。
 */
function applyContribution(
  root: Frame,
  target: Frame,
  contribution: Contribution,
  afterAnchors: Map<string, Frame>,
): Frame | null {
  const { op, tree } = contribution;

  if (op === "append") {
    target.children.push(frameOf(tree, target));
    return root;
  }

  if (op === "replace") {
    const stamped = stampKey(tree, contribution.target, contribution.owner);
    const parent = target.parent;
    if (parent === null) {
      // 目标就是整棵树的根：整棵换掉，目标键打在新根上。
      return frameOf(stamped, null);
    }
    const at = parent.children.indexOf(target);
    if (at < 0) {
      return null;
    }
    parent.children[at] = frameOf(stamped, parent);
    return root;
  }

  const parent = target.parent;
  if (parent === null) {
    return null;
  }

  if (op === "before") {
    const at = parent.children.indexOf(target);
    if (at < 0) {
      return null;
    }
    parent.children.splice(at, 0, frameOf(tree, parent));
    return root;
  }

  const anchor = afterAnchors.get(contribution.target) ?? target;
  const at = parent.children.indexOf(anchor);
  if (at < 0) {
    return null;
  }
  const inserted = frameOf(tree, parent);
  parent.children.splice(at + 1, 0, inserted);
  afterAnchors.set(contribution.target, inserted);
  return root;
}

/**
 * 组合：先定序，再反复扫到不动。
 *
 * 一轮里先应用落点已经存在的贡献；新贡献带进来的键下一轮才可用。一整轮
 * 一份都落不下就停，剩下的都是死键：警告后丢弃，不抛。
 */
export function compose(root: Node, contributions: readonly Contribution[]): ComposeResult {
  let rootFrame = frameOf(root, null);
  let queue = prepare(contributions);
  const afterAnchors = new Map<string, Frame>();

  while (queue.length > 0) {
    const deferred: Contribution[] = [];
    let applied = 0;

    for (const contribution of queue) {
      const target = frameIndex(rootFrame).get(contribution.target);
      if (target === undefined) {
        deferred.push(contribution);
        continue;
      }
      const nextRoot = applyContribution(rootFrame, target, contribution, afterAnchors);
      if (nextRoot === null) {
        deferred.push(contribution);
        continue;
      }
      rootFrame = nextRoot;
      applied += 1;
    }

    queue = deferred;
    if (applied === 0) {
      break;
    }
  }

  for (const contribution of queue) {
    console.warn(
      `[compose] 丢弃贡献：owner=${contribution.owner} target=${contribution.target} op=${contribution.op}（落点不存在或挂不上）`,
    );
  }

  const tree = freeze(rootFrame);
  return { tree, index: nodeIndex(tree) };
}
