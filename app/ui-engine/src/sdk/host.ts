/**
 * node scope：每个节点一个 host，创建它的父节点是它的 immediate host。
 *
 * 契约：`schema/sdk/scope.json` 的 `request` / `capability`。host 有三种状态：
 * - open：正常处理请求、发放能力；
 * - moved：节点被 move 到新父，旧 host 的请求回 HostMoved，旧能力端口抛
 *   E-SCOPE-HOST-MOVED（能力随 rebind 失效）；
 * - gone：节点被 remove / unmount，旧 host 的请求回 HostGone，能力抛 E-SCOPE-HOST-GONE。
 *
 * 标准请求父有 handle-or-deny 义务：未配置处理器抛 E-SCOPE-REQUEST-UNHANDLED；
 * 未知请求按契约回 unhandled。`forward` 是显式转发，一次只上一层。
 */

import {
  Denied,
  Handled,
  HostGone,
  HostMoved,
  Request,
  ScopeError,
  STANDARD_REQUEST_ERROR_CODE,
  Unhandled,
  isStandardRequest,
  type Response,
  type ScopeErrorCode,
} from "./requests";
import {
  createCapabilityPort,
  type CapabilityPort,
  type CapabilityPortMap,
  type CapabilityType,
  type PortTarget,
} from "./capabilities";
import type { Node } from "./scope";

/** 父节点的应答策略；返回 undefined 表示父没履约（标准请求会抛错）。 */
export type RequestHandler = (request: Request, host: Host) => Response | undefined;

export type HostFactory = (owner: Node, child: Node) => Host;

export type HostStatus = "open" | "moved" | "gone";

export interface HostOptions {
  owner: Node;
  child: Node;
  handler?: RequestHandler;
}

interface CapabilityRecord {
  revoked: boolean;
  port?: CapabilityPort;
}

/** 一个子节点的 host：owner 是它父节点，请求在 owner 这一层处理。 */
export class Host implements PortTarget {
  // 子通过 node.host 拿得到 host，所以父对象与子对象都保持私有：
  // 子不能借 host 拿到可变的父句柄（契约 capability.exposesParent=false）。
  private readonly owner: Node;
  private readonly child: Node;
  private readonly handler: RequestHandler | undefined;
  private status: HostStatus = "open";
  private readonly capabilities = new Map<CapabilityType, CapabilityRecord>();

  constructor(options: HostOptions) {
    this.owner = options.owner;
    this.child = options.child;
    this.handler = options.handler;
  }

  get state(): HostStatus {
    return this.status;
  }

  get closed(): boolean {
    return this.status === "gone";
  }

  get moved(): boolean {
    return this.status === "moved";
  }

  /** 节点被 remove / unmount：旧 host 记为 gone。 */
  close(): void {
    this.status = "gone";
  }

  /** 节点被 move 重绑：旧 host 记为 moved，与 gone 区分。 */
  markMoved(): void {
    this.status = "moved";
  }

  request(request: Request): Response {
    if (this.status === "moved") {
      return new HostMoved(request.name);
    }
    if (this.status === "gone") {
      return new HostGone(request.name);
    }
    if (!isStandardRequest(request.name)) {
      return new Unhandled(request.name);
    }
    const handler = this.handler;
    if (handler === undefined) {
      throw new ScopeError(
        STANDARD_REQUEST_ERROR_CODE,
        "标准请求 " + request.name + " 必须由父 handle 或 deny",
      );
    }
    const response = handler(request, this);
    if (response === undefined) {
      throw new ScopeError(
        STANDARD_REQUEST_ERROR_CODE,
        "标准请求 " + request.name + " 必须由父 handle 或 deny",
      );
    }
    // 处理期间节点可能已被移走 / 卸载 / 关闭：旧 host 的应答作废。
    if (this.state === "gone") {
      return new HostGone(request.name);
    }
    if (this.state === "moved" || this.child.host !== this) {
      return new HostMoved(request.name);
    }
    return response;
  }

  handle(value?: unknown): Handled {
    return new Handled(value);
  }

  deny(message: string, code: ScopeErrorCode = "E-SCOPE-PARENT"): Denied {
    return new Denied(code, message);
  }

  /** 显式转发到 owner 的 host（即再上一层）；到根仍没人接就 unhandled。 */
  forward(request: Request): Response {
    this.requireLive();
    const ownerHost = this.owner.host;
    if (ownerHost === null) {
      return new Unhandled(request.name);
    }
    return ownerHost.request(request);
  }

  grant(type: CapabilityType): void {
    this.capabilities.set(type, { revoked: false });
  }

  revoke(type: CapabilityType): void {
    const record = this.capabilities.get(type);
    if (record !== undefined) {
      record.revoked = true;
    }
  }

  capability<T extends CapabilityType>(type: T): CapabilityPortMap[T] | undefined {
    this.requireLive();
    const record = this.capabilities.get(type);
    if (record === undefined) {
      return undefined;
    }
    if (record.revoked) {
      throw new ScopeError("E-SCOPE-CAPABILITY-REVOKED", type + " 能力已撤销");
    }
    record.port ??= createCapabilityPort(this, type);
    return record.port as CapabilityPortMap[T];
  }

  assertUsable(type: CapabilityType): void {
    this.requireLive();
    const record = this.capabilities.get(type);
    if (record === undefined || record.revoked) {
      throw new ScopeError("E-SCOPE-CAPABILITY-REVOKED", type + " 能力未授予或已撤销");
    }
  }

  /** 旧 host 的请求面：moved / gone 都抛稳定错误（与 request() 的 Response 区分）。 */
  private requireLive(): void {
    if (this.status === "moved") {
      throw new ScopeError("E-SCOPE-HOST-MOVED", "host 已被 move 顶替");
    }
    if (this.status === "gone") {
      throw new ScopeError("E-SCOPE-HOST-GONE", "host 已关闭");
    }
  }
}

/** 默认 host：没有处理器；标准请求会按父侧违规抛错，未知请求回 unhandled。 */
export function defaultHostFactory(owner: Node, child: Node): Host {
  return new Host({ owner, child });
}
