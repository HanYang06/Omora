/**
 * node scope：retained-mode 节点树核心（不是 UI 组件、不是 React）。
 *
 * 契约：`schema/sdk/scope.json`。父拥有子树、权限向下；子只拿到只读 ParentRef。
 * 每个挂载的子有一个父创建的 host：请求上行、能力下行。
 *
 * 生命周期：mount 父先子后，unmount 子先父后；on_create 在构造期触发（无 parent/host）。
 * remove / unmount 保留子树；只有 root 的 dispose 才永久销毁（之后不可再挂载）。
 */

import { defaultHostFactory, type Host, type HostFactory } from "./host";
import { HostGone, Request, ScopeError, type Response } from "./requests";
import type { CapabilityType } from "./capabilities";

export const SCOPE_SCHEMA = "omora.scope/1";
export const SCOPE_VERSION = 1;

/** 子看到的父身份：只读快照，不含可变父对象。 */
export interface ParentRef {
  readonly id: string;
  readonly kind: string;
}

/** 契约 `lifecycle.hooks` 的运行时镜像；名字与契约保持一致。 */
export const LIFECYCLE_HOOKS = [
  "on_create",
  "on_mount",
  "on_update",
  "on_reparent",
  "on_unmount",
  "on_dispose",
] as const;

export type LifecycleHook = (typeof LIFECYCLE_HOOKS)[number];

/** 生命周期钩子；V1 没有 dispose 操作，on_dispose 只留接口。 */
export type LifecycleHooks = Partial<Record<LifecycleHook, (node: Node) => void>>;

export interface NodeOptions {
  /** 省略则出生时随机生成 16 位小写十六进制。 */
  id?: string;
  kind: string;
  props?: Record<string, unknown>;
  state?: Record<string, unknown>;
  /** 父为子创建 host 的工厂；只有父节点自己的选项会用于它的直接子节点。 */
  host?: HostFactory;
  lifecycle?: LifecycleHooks;
}

export interface AddOptions {
  index?: number;
}

export interface MoveOptions {
  index?: number;
  /** true 时先 unmount 再 mount（默认只换父、不触发 unmount）。 */
  remount?: boolean;
}

const ID_PATTERN = /^[0-9a-f]{16}$/;

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function copyRecord(value: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(value);
}

export class Node {
  readonly id: string;
  readonly kind: string;
  readonly props: Record<string, unknown>;
  readonly state: Record<string, unknown>;

  private readonly hostFactory: HostFactory;
  private readonly hooks: LifecycleHooks | undefined;
  private parentNode: Node | null = null;
  private parentRef: ParentRef | null = null;
  private hostValue: Host | null = null;
  private childNodes: Node[] = [];
  /** detached 子树（remove / clone / unmount 的根）不再向子节点发 host。 */
  private inert = false;
  /** dispose 是永久销毁：disposed 节点不能再挂载 / 移动。 */
  private disposedState = false;

  constructor(options: NodeOptions) {
    if (typeof options.kind !== "string" || options.kind.length === 0) {
      throw new TypeError("kind 必须是非空字符串");
    }
    this.id = options.id ?? newId();
    if (!ID_PATTERN.test(this.id)) {
      throw new TypeError("id 必须是 16 位小写十六进制: " + this.id);
    }
    this.kind = options.kind;
    this.props = { ...options.props };
    this.state = { ...options.state };
    this.hostFactory = options.host ?? defaultHostFactory;
    this.hooks = options.lifecycle;
    // 构造期边界：此时 parent / host 都还没有，on_create 只应做节点自身初始化。
    this.fire("on_create");
  }

  get parent(): ParentRef | null {
    return this.parentRef;
  }
  get host(): Host | null {
    return this.hostValue;
  }
  get children(): readonly Node[] {
    return this.childNodes;
  }

  /** 有 host 才算挂载；root 自身没有 host，但子节点可以挂载。 */
  get mounted(): boolean {
    return this.hostValue !== null;
  }

  get disposed(): boolean {
    return this.disposedState;
  }

  add(child: Node, options: AddOptions = {}): Node {
    if (this.disposedState || child.disposedState) {
      throw new TypeError("已销毁的节点不能再挂载");
    }
    if (child === this || child.isAncestorOf(this)) {
      throw new ScopeError("E-SCOPE-CYCLE", "add 会成环: " + child.id);
    }
    if (child.parentNode !== null) {
      throw new ScopeError("E-SCOPE-DUP-MOUNT", "节点已有父: " + child.id);
    }
    this.insertAt(child, options.index);
    child.parentNode = this;
    child.parentRef = Node.refOf(this);
    child.inert = false;
    if (this.live) {
      child.rebuildHosts();
      child.fireMountSubtree();
    } else {
      child.closeSubtreeHosts();
    }
    return child;
  }

  remove(child: Node): Node {
    if (this.disposedState || child.disposedState) {
      throw new TypeError("已销毁的节点不能再移除");
    }
    this.assertOwnChild(child, "remove");
    this.detach(child);
    child.closeSubtreeHosts();
    child.parentNode = null;
    child.parentRef = null;
    child.inert = true;
    child.fireUnmountSubtree();
    return child;
  }

  /** 只能 root（parent 为空）调用；级联卸载整棵子树，子节点自移除只能走 remove / remove_self。 */
  unmount(): this {
    if (this.parentNode !== null) {
      throw new ScopeError(
        "E-SCOPE-PARENT",
        "只有 root 能 unmount；子节点用 parent.remove 或 request(remove_self)",
      );
    }
    if (this.disposedState) {
      return this;
    }
    this.closeSubtreeHosts();
    this.inert = true;
    this.fireUnmountSubtree();
    return this;
  }

  /**
   * 只允许 root（parent 为空）调用：永久销毁整棵树。
   * 先按 unmount 语义卸载（子先父后 on_unmount），再按子先父后触发 on_dispose；
   * 子树结构保留，但 disposed 节点不能再挂载。重复 dispose 幂等。
   */
  dispose(): this {
    if (this.parentNode !== null) {
      throw new ScopeError("E-SCOPE-PARENT", "只有 root 能 dispose；子节点由父级销毁");
    }
    if (this.disposedState) {
      return this;
    }
    if (!this.inert) {
      this.closeSubtreeHosts();
      this.inert = true;
      this.fireUnmountSubtree();
    }
    this.markDisposedSubtree();
    return this;
  }

  move(child: Node, newParent: Node, options: MoveOptions = {}): Node {
    if (this.disposedState || child.disposedState || newParent.disposedState) {
      throw new TypeError("已销毁的节点不能再移动");
    }
    this.assertOwnChild(child, "move");
    if (newParent === child || child.isAncestorOf(newParent)) {
      throw new ScopeError("E-SCOPE-MOVE-SELF", "move 目标是节点自己或它的后代");
    }
    if (newParent === this) {
      this.detach(child);
      this.insertAt(child, options.index);
      return child;
    }
    const wasMounted = child.mounted;
    const targetLive = newParent.live;
    const remount = options.remount === true || wasMounted !== targetLive;
    if (wasMounted && remount) {
      child.fireUnmountSubtree();
    }
    if (remount) {
      child.closeSubtreeHosts();
    } else {
      child.markSelfHostMoved();
    }
    this.detach(child);
    newParent.insertAt(child, options.index);
    child.parentNode = newParent;
    child.parentRef = Node.refOf(newParent);
    child.inert = false;
    child.fire("on_reparent");
    if (targetLive) {
      if (remount) {
        child.rebuildHosts();
        child.fireMountSubtree();
      } else {
        child.bindSelfHost();
      }
    }
    return child;
  }

  clone(): Node {
    const copy = new Node({
      kind: this.kind,
      props: copyRecord(this.props),
      state: copyRecord(this.state),
      host: this.hostFactory,
      lifecycle: this.hooks,
    });
    copy.inert = true;
    for (const child of this.childNodes) {
      copy.add(child.clone());
    }
    return copy;
  }

  patch(patch: { props?: Record<string, unknown>; state?: Record<string, unknown> }): this {
    if (patch.props !== undefined) {
      Object.assign(this.props, patch.props);
    }
    if (patch.state !== undefined) {
      Object.assign(this.state, patch.state);
    }
    this.fire("on_update");
    return this;
  }

  request(name: string, fields: Record<string, unknown> = {}): Response {
    const host = this.hostValue;
    if (host === null) {
      return new HostGone(name);
    }
    return host.request(new Request(name, fields));
  }

  grant(child: Node, type: CapabilityType): this {
    this.assertOwnChild(child, "grant");
    if (child.hostValue === null) {
      throw new ScopeError("E-SCOPE-HOST-GONE", "节点没有 host，无法授权: " + child.id);
    }
    child.hostValue.grant(type);
    return this;
  }

  revoke(child: Node, type: CapabilityType): this {
    this.assertOwnChild(child, "revoke");
    if (child.hostValue === null) {
      throw new ScopeError("E-SCOPE-HOST-GONE", "节点没有 host，无法撤权: " + child.id);
    }
    child.hostValue.revoke(type);
    return this;
  }

  private get live(): boolean {
    return this.hostValue !== null || (this.parentNode === null && !this.inert);
  }

  private isAncestorOf(node: Node): boolean {
    let current = node.parentNode;
    while (current !== null) {
      if (current === this) {
        return true;
      }
      current = current.parentNode;
    }
    return false;
  }

  private assertOwnChild(child: Node, operation: string): void {
    if (child.parentNode === this) {
      return;
    }
    if (child !== this && child.isAncestorOf(this)) {
      throw new ScopeError("E-SCOPE-PARENT", operation + " 不能改父: " + child.id);
    }
    throw new ScopeError("E-SCOPE-NOT-CHILD", operation + " 目标不是自己的子节点: " + child.id);
  }

  private insertAt(child: Node, index: number | undefined): void {
    const at = Math.max(0, Math.min(index ?? this.childNodes.length, this.childNodes.length));
    this.childNodes.splice(at, 0, child);
  }

  private detach(child: Node): void {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
  }

  private bindSelfHost(): void {
    const parent = this.parentNode;
    if (parent !== null && parent.live) {
      this.hostValue = parent.createHostFor(this);
      this.inert = false;
    } else {
      this.hostValue = null;
    }
  }

  private rebuildHosts(): void {
    this.closeSelfHost();
    this.bindSelfHost();
    for (const child of this.childNodes) {
      child.rebuildHosts();
    }
  }

  private closeSelfHost(): void {
    this.hostValue?.close();
    this.hostValue = null;
  }

  private markSelfHostMoved(): void {
    this.hostValue?.markMoved();
    this.hostValue = null;
  }

  private closeSubtreeHosts(): void {
    this.closeSelfHost();
    for (const child of this.childNodes) {
      child.closeSubtreeHosts();
    }
  }

  private createHostFor(child: Node): Host {
    return this.hostFactory(this, child);
  }

  private fire(hook: LifecycleHook): void {
    this.hooks?.[hook]?.(this);
  }

  /** mount：父先子后（契约 lifecycle.order.mount）。 */
  private fireMountSubtree(): void {
    this.fire("on_mount");
    for (const child of this.childNodes) {
      child.fireMountSubtree();
    }
  }

  /** unmount：子先父后（契约 lifecycle.order.unmount）。 */
  private fireUnmountSubtree(): void {
    for (const child of this.childNodes) {
      child.fireUnmountSubtree();
    }
    this.fire("on_unmount");
  }

  /** dispose：子先父后，每个节点只销毁一次。 */
  private markDisposedSubtree(): void {
    for (const child of this.childNodes) {
      child.markDisposedSubtree();
    }
    if (!this.disposedState) {
      this.disposedState = true;
      this.fire("on_dispose");
    }
  }

  private static refOf(node: Node): ParentRef {
    return Object.freeze({ id: node.id, kind: node.kind });
  }
}
