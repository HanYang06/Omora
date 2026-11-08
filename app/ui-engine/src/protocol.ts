/**
 * 帧的形状。与 Python 的 app/sdk/protocol.py 各实现一份，
 * 由 app/sdk/tests/fixtures/protocol.json 钉住。
 *
 * 渲染引擎只造 call、只解 result / error；不需要 parse_call。
 */

export type JsonObject = Record<string, unknown>;

export interface CallFrame {
  id: string;
  type: "call";
  target: string;
  method: string;
  args: JsonObject;
}

export interface ResultFrame {
  id: string;
  type: "result";
  value: unknown;
}

export interface ErrorFrame {
  id: string | null;
  type: "error";
  code: string;
  message: string;
}

export type InboundFrame = ResultFrame | ErrorFrame;

export const BAD_FRAME = "bad_frame";

/** 与 Python 的 FrameError 同形状：code 与 frame_id 会带给对端。 */
export class FrameError extends Error {
  readonly code: string;
  readonly frameId: string | null;

  constructor(code: string, message: string, frameId: string | null = null) {
    super(message);
    this.name = "FrameError";
    this.code = code;
    this.frameId = frameId;
  }
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function asFrameId(value: unknown): string | null {
  return isNonEmptyString(value) ? value : null;
}

/** 造一帧 call。args 缺省为 {}，与 Python 的 parse_call 一致。 */
export function makeCall(
  id: string,
  target: string,
  method: string,
  args: JsonObject = {},
): CallFrame {
  if (!isNonEmptyString(id)) {
    throw new FrameError(BAD_FRAME, "id 必须是非空字符串");
  }
  if (!isNonEmptyString(target)) {
    throw new FrameError(BAD_FRAME, "target 必须是非空字符串", id);
  }
  if (!isNonEmptyString(method)) {
    throw new FrameError(BAD_FRAME, "method 必须是非空字符串", id);
  }
  if (!isRecord(args)) {
    throw new FrameError(BAD_FRAME, "args 必须是对象", id);
  }
  return { id, type: "call", target, method, args };
}

/**
 * 判定一帧是否是合法的 call（与 Python parse_call 的规则一致）。
 * 只做判定，不做归一化：缺 args 的帧合法，视同 {}。
 */
export function isCallFrame(raw: unknown): boolean {
  if (!isRecord(raw)) {
    return false;
  }
  if (!isNonEmptyString(raw.id)) {
    return false;
  }
  if (raw.type !== "call") {
    return false;
  }
  if (!isNonEmptyString(raw.target)) {
    return false;
  }
  if (!isNonEmptyString(raw.method)) {
    return false;
  }
  if (raw.args !== undefined && !isRecord(raw.args)) {
    return false;
  }
  return true;
}

/**
 * 解一帧 result / error。不合法抛 FrameError(bad_frame)。
 * error 允许 id 为 null（帧没解析出来时，Python 侧无法回填 id）。
 */
export function parseInboundFrame(raw: unknown): InboundFrame {
  if (!isRecord(raw)) {
    throw new FrameError(BAD_FRAME, "帧必须是对象");
  }

  const frameId = asFrameId(raw.id);

  if (raw.type === "result") {
    if (frameId === null) {
      throw new FrameError(BAD_FRAME, "result.id 必须是非空字符串");
    }
    return { id: frameId, type: "result", value: raw.value };
  }

  if (raw.type === "error") {
    if (raw.id !== null && frameId === null) {
      throw new FrameError(BAD_FRAME, "error.id 必须是非空字符串或 null");
    }
    if (!isNonEmptyString(raw.code)) {
      throw new FrameError(BAD_FRAME, "error.code 必须是非空字符串", frameId);
    }
    if (typeof raw.message !== "string") {
      throw new FrameError(BAD_FRAME, "error.message 必须是字符串", frameId);
    }
    return { id: frameId, type: "error", code: raw.code, message: raw.message };
  }

  throw new FrameError(BAD_FRAME, "type 必须是 result 或 error", frameId);
}
