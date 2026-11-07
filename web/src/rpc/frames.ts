import type { ErrorCode, SliceUpdate } from "../contract";
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
  const { type, revision, data, updates } = params;
  if (typeof type !== "string" || type.length === 0) {
    return null;
  }
  if (!isEventRevision(revision)) {
    return null;
  }
  if (!isOptionalRecord(data)) {
    return null;
  }
  const parsedUpdates = readUpdates(updates);
  if (parsedUpdates === null) {
    return null;
  }
  return {
    type,
    revision,
    ...(data === undefined ? {} : { data }),
    ...(parsedUpdates === undefined ? {} : { updates: parsedUpdates }),
  };
}

function isEventRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isOptionalRecord(value: unknown): value is Record<string, unknown> | undefined {
  return value === undefined || isRecord(value);
}

function readUpdates(value: unknown): SliceUpdate[] | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const updates: SliceUpdate[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.owner !== "string" ||
      item.owner.length === 0 ||
      !isRecord(item.state)
    ) {
      return null;
    }
    updates.push({ owner: item.owner, state: item.state });
  }
  return updates;
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
