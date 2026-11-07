import type { ErrorCode } from "../contract";
import { isRecord } from "../lib/guards";
import type { C1Event } from "../store/projection";

export class C1Error extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "C1Error";
    this.code = code;
  }
}

export function decodeFrame(payload: string): Record<string, unknown> | null {
  try {
    const decoded: unknown = JSON.parse(payload);
    return isRecord(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export function readEvent(params: Record<string, unknown>): C1Event | null {
  const { type, revision, data, owner, state } = params;
  if (typeof type !== "string" || type.length === 0) {
    return null;
  }
  if (!isEventRevision(revision)) {
    return null;
  }
  if (!isOptionalOwner(owner) || !isOptionalRecord(data) || !isOptionalRecord(state)) {
    return null;
  }
  return {
    type,
    revision,
    ...(data === undefined ? {} : { data }),
    ...(owner === undefined ? {} : { owner }),
    ...(state === undefined ? {} : { state }),
  };
}

function isEventRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isOptionalOwner(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.length > 0);
}

function isOptionalRecord(value: unknown): value is Record<string, unknown> | undefined {
  return value === undefined || isRecord(value);
}

export function readError(value: unknown): Error {
  if (!isRecord(value)) {
    return new C1Error("E_INTERNAL", "C1 错误响应格式无效");
  }
  const message =
    typeof value.message === "string" && value.message.length > 0 ? value.message : "C1 错误";
  return new C1Error(readCode(value.code), message);
}

export function toError(value: unknown): Error {
  return value instanceof Error ? value : new C1Error("E_INTERNAL", "C1 请求失败");
}

function readCode(value: unknown): ErrorCode {
  if (
    value === "E_INVALID" ||
    value === "E_DENIED" ||
    value === "E_UNAVAILABLE" ||
    value === "E_INTERNAL"
  ) {
    return value;
  }
  return "E_INTERNAL";
}
