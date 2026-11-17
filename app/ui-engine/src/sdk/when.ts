/**
 * Page 层：When 条件描述（契约 schema/sdk/page.json -> when）。
 *
 * When 挂在节点上：condition 读 page.state 选 then / otherwise 分支。解析发生在
 * mount / invalidate，只重排这个节点的直接子节点——容器节点本身与兄弟子树不动，
 * 分支节点按同一 Node 实例复用（id 出生即稳定）。
 */

import type { Page } from "./page";
import type { Node } from "./scope";

export interface WhenDescriptor {
  /** 谓词：通常读 page.state 决定分支。 */
  condition: (page: Page) => boolean;
  then: readonly Node[];
  otherwise: readonly Node[];
}

/** 解析一个 When：只改 node 的 children，容器与兄弟都不动。 */
export function resolveWhen(page: Page, node: Node, when: WhenDescriptor): void {
  const branch = when.condition(page) ? when.then : when.otherwise;
  const wanted = new Set(branch);
  for (const child of [...node.children]) {
    if (!wanted.has(child)) {
      node.remove(child);
    }
  }
  branch.forEach((child, index) => {
    if (node.children[index] === child) {
      return;
    }
    const parent = child.parent;
    if (parent === null) {
      node.add(child, { index });
    } else if (parent.id === node.id) {
      node.move(child, node, { index });
    } else {
      throw new TypeError("When 分支节点已挂在别处: " + child.id);
    }
  });
}
