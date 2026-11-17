/**
 * Page 层（契约 schema/sdk/page.json）：一个 root Node scope + 页面私有 state +
 * 显式 mount / invalidate + actions。不是 render(state) 纯函数。
 *
 * - Page 拥有 root Node；挂载由外部 host 承接（mount / update / unmount 回调）；
 * - state 是页面私有的 mutable mapping，改动后显式 page.invalidate()；
 * - invalidate 只重新解析 When / Bind 并通知 host，不重跑任何 page 函数；
 * - 子节点拿不到 Page，因此不能直接改 page.state，只能走 page 的 action / request。
 */

import { Node } from "./scope";
import { assertBindSource, resolveBind, type BindDescriptor } from "./bind";
import { resolveWhen, type WhenDescriptor } from "./when";

/** 事件处理函数：改 page.state；Page.invoke 负责随后 invalidate。 */
export type ActionHandler = (page: Page, payload?: unknown) => void;

/** 外部挂载点：Page 只通过这三个回调与外面交互，不碰 UI / engine。 */
export interface PageHost {
  /** Bind 的 data.* 来源。 */
  readonly data?: Record<string, unknown>;
  mount(page: Page): void;
  update(page: Page): void;
  unmount(page: Page): void;
}

function isBindList(
  value: BindDescriptor | readonly BindDescriptor[],
): value is readonly BindDescriptor[] {
  return Array.isArray(value);
}

export interface PageOptions {
  name: string;
  label?: string;
  icon?: string;
  /** 页面根 Node scope；必须尚未挂到别的父节点上。 */
  root: Node;
  state?: Record<string, unknown>;
  actions?: Record<string, ActionHandler>;
}

export class Page {
  readonly name: string;
  readonly label: string;
  readonly icon: string | undefined;
  readonly root: Node;
  readonly state: Record<string, unknown>;

  private readonly actionHandlers = new Map<string, ActionHandler>();
  private readonly whens = new Map<Node, WhenDescriptor>();
  private readonly binds = new Map<Node, BindDescriptor[]>();
  private readonly nodeEvents = new Map<Node, Map<string, string>>();
  private hostValue: PageHost | null = null;
  private mountedState = false;

  constructor(options: PageOptions) {
    if (typeof options.name !== "string" || options.name.length === 0) {
      throw new TypeError("page.name 必须是非空字符串");
    }
    if (!(options.root instanceof Node)) {
      throw new TypeError("page.root 必须是 Node");
    }
    if (options.root.parent !== null) {
      throw new TypeError("page.root 必须是未挂载的 root Node");
    }
    this.name = options.name;
    this.label = options.label ?? options.name;
    this.icon = options.icon;
    this.root = options.root;
    this.state = { ...options.state };
    for (const [name, handler] of Object.entries(options.actions ?? {})) {
      this.action(name, handler);
    }
  }

  get mounted(): boolean {
    return this.mountedState;
  }

  /** 契约 page.fields 里的 actions：action 名 -> 处理函数。 */
  get actions(): ReadonlyMap<string, ActionHandler> {
    return this.actionHandlers;
  }

  /** Bind 的 data.* 来源；来自当前 host。 */
  get hostData(): Readonly<Record<string, unknown>> | undefined {
    return this.hostValue?.data;
  }

  action(name: string, handler: ActionHandler): this {
    if (typeof name !== "string" || name.length === 0) {
      throw new TypeError("action.name 必须是非空字符串");
    }
    if (typeof handler !== "function") {
      throw new TypeError("action.handler 必须是函数");
    }
    this.actionHandlers.set(name, handler);
    return this;
  }

  /** 把节点事件绑到 action id（等价于树里 tree.on 的 handler id）。 */
  on(node: Node, event: string, actionName: string): this {
    if (!(node instanceof Node)) {
      throw new TypeError("on 的 node 必须是 Node");
    }
    if (typeof event !== "string" || event.length === 0) {
      throw new TypeError("事件名必须是非空字符串");
    }
    if (!this.actionHandlers.has(actionName)) {
      throw new Error("未知 action: " + actionName);
    }
    const events = this.nodeEvents.get(node) ?? new Map<string, string>();
    events.set(event, actionName);
    this.nodeEvents.set(node, events);
    return this;
  }

  /** 触发节点事件：找到绑定的 action，执行后自动 invalidate。 */
  event(node: Node, event: string, payload?: unknown): this {
    const actionName = this.nodeEvents.get(node)?.get(event);
    if (actionName === undefined) {
      throw new Error("节点上没有事件绑定: " + event);
    }
    return this.invoke(actionName, payload);
  }

  /** 执行 action：handler 改 state，随后 Page 统一 invalidate。 */
  invoke(actionName: string, payload?: unknown): this {
    const handler = this.actionHandlers.get(actionName);
    if (handler === undefined) {
      throw new Error("未知 action: " + actionName);
    }
    if (!this.mountedState) {
      throw new Error("page 未挂载，不能执行 action");
    }
    handler(this, payload);
    return this.invalidate();
  }

  when(node: Node, when: WhenDescriptor): this {
    if (!(node instanceof Node)) {
      throw new TypeError("when 的 node 必须是 Node");
    }
    if (
      typeof when.condition !== "function" ||
      !Array.isArray(when.then) ||
      !Array.isArray(when.otherwise)
    ) {
      throw new TypeError("when 需要 condition / then / otherwise");
    }
    this.whens.set(node, when);
    return this;
  }

  bind(node: Node, binding: BindDescriptor | readonly BindDescriptor[]): this {
    if (!(node instanceof Node)) {
      throw new TypeError("bind 的 node 必须是 Node");
    }
    const additions = isBindList(binding) ? binding : [binding];
    const merged = new Map((this.binds.get(node) ?? []).map((item) => [item.prop, item]));
    for (const item of additions) {
      assertBindSource(item.source);
      merged.set(item.prop, item);
    }
    this.binds.set(node, [...merged.values()]);
    return this;
  }

  /** 显式挂载：先解析 When / Bind，再交给外部 host。 */
  mount(host: PageHost): this {
    if (this.mountedState) {
      throw new Error("page 已挂载");
    }
    this.hostValue = host;
    this.resolve();
    this.mountedState = true;
    host.mount(this);
    return this;
  }

  /** 重新解析 When / Bind 并通知 host；不重跑 page 函数。 */
  invalidate(): this {
    if (!this.mountedState) {
      throw new Error("page 未挂载，不能 invalidate");
    }
    this.resolve();
    this.hostValue?.update(this);
    return this;
  }

  /** root-only：Page 的 root 是 scope root，卸载走 Node.unmount 的级联语义。 */
  unmount(): this {
    if (!this.mountedState) {
      throw new Error("page 未挂载，不能 unmount");
    }
    this.root.unmount();
    this.hostValue?.unmount(this);
    this.hostValue = null;
    this.mountedState = false;
    return this;
  }

  private resolve(): void {
    for (const [node, when] of this.whens) {
      resolveWhen(this, node, when);
    }
    for (const [node, bindings] of this.binds) {
      resolveBind(this, node, bindings);
    }
  }
}
