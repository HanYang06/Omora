/**
 * node scope：请求 / 响应与稳定错误码。
 *
 * 契约：`schema/sdk/scope.json`。请求只到 immediate host，不自动冒泡；父对标准请求
 * 必须 handle 或 deny（不能静默忽略），未知请求以 unhandled 回。错误码是跨语言稳定
 * 接口，集合与契约 `errors` 一致；放在这一层是为了让 scope / host / capabilities
 * 共用而不用互相 import。
 */

export const SCOPE_ERROR_CODES = [
  "E-SCOPE-PARENT",
  "E-SCOPE-CYCLE",
  "E-SCOPE-DUP-MOUNT",
  "E-SCOPE-NOT-CHILD",
  "E-SCOPE-MOVE-SELF",
  "E-SCOPE-HOST-GONE",
  "E-SCOPE-HOST-MOVED",
  "E-SCOPE-REQUEST-UNHANDLED",
  "E-SCOPE-CAPABILITY-REVOKED",
] as const;

export type ScopeErrorCode = (typeof SCOPE_ERROR_CODES)[number];

/** 契约 `request.standardDefault`：标准请求没有处理器时抛的稳定错误码。 */
export const STANDARD_REQUEST_ERROR_CODE: ScopeErrorCode = "E-SCOPE-REQUEST-UNHANDLED";

/** 稳定作用域错误：`code` 是契约里的 E-SCOPE-*，调用方按码分支。 */
export class ScopeError extends Error {
  readonly code: ScopeErrorCode;

  constructor(code: ScopeErrorCode, message: string) {
    super(code + ": " + message);
    this.name = "ScopeError";
    this.code = code;
  }
}

export type StandardFieldType = "string" | "object";

/**
 * 契约 `request.standard` 的运行时镜像：字段名 -> 字段类型。
 * 父级据此知道自己必须响应哪些请求；端口给出的载荷也按这张表构造。
 */
export const STANDARD_REQUESTS = {
  remove_self: {},
  navigate: { route: "string" },
  focus: {},
  scroll_into_view: {},
  open_overlay: { kind: "string", props: "object" },
  request_data: { source: "string", key: "string" },
} as const satisfies Record<string, Readonly<Record<string, StandardFieldType>>>;

export type StandardRequestName = keyof typeof STANDARD_REQUESTS;

export function isStandardRequest(name: string): name is StandardRequestName {
  return Object.hasOwn(STANDARD_REQUESTS, name);
}

/** 自下而上的请求；`fields` 是载荷，构造时复制一份，避免调用方后续改入参。 */
export class Request {
  readonly name: string;
  readonly fields: Readonly<Record<string, unknown>>;

  constructor(name: string, fields: Record<string, unknown> = {}) {
    this.name = name;
    this.fields = { ...fields };
  }
}

export const RESPONSE_KINDS = [
  "handled",
  "denied",
  "unhandled",
  "host_gone",
  "host_moved",
] as const;

export type ResponseKind = (typeof RESPONSE_KINDS)[number];

/** 父级处理了请求；`value` 由调用约定解释。 */
export class Handled {
  readonly kind = "handled";

  constructor(readonly value?: unknown) {}
}

/** 父级拒绝请求；`code` 用稳定 E-SCOPE-*（默认 E-SCOPE-PARENT）。 */
export class Denied {
  readonly kind = "denied";

  constructor(
    readonly code: ScopeErrorCode,
    readonly message: string,
  ) {}
}

/** 未知请求：契约规定 unknown -> unhandled，没有处理器可调。 */
export class Unhandled {
  readonly kind = "unhandled";

  constructor(readonly request: string) {}
}

/** 请求到达时 host 已关闭（或节点已不在任何 host 上）。 */
export class HostGone {
  readonly kind = "host_gone";

  constructor(readonly request: string) {}
}

/** 处理期间节点被移走，原 host 的应答作废。 */
export class HostMoved {
  readonly kind = "host_moved";

  constructor(readonly request: string) {}
}

export type Response = Handled | Denied | Unhandled | HostGone | HostMoved;
