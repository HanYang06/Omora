import type { Node, PageEntry, Snapshot } from "../core/types";

/**
 * ui.snapshot 的载荷（协议 §6）有两种：带 `content` 的全量、带 `ops` 的补丁。
 * 服务端永远给全量兜底，客户端负责判断这一条到底能不能用——判断只有这一处。
 */

export type PathPart = string | number;

export type PatchOp =
  | { op: "set"; path: PathPart[]; value: unknown }
  | { op: "insert"; path: PathPart[]; index: number; value: Node }
  | { op: "remove"; path: PathPart[]; index: number };

export type SnapshotUpdate =
  { ok: true; snapshot: Snapshot } | { ok: false; reason: "page" | "version" | "malformed" };

type JsonObject = Record<string, unknown>;

/** 应用一条 ui.snapshot 载荷：全量整棵替换，补丁按路径改，改动沿路径复制。 */
export function applySnapshotUpdate(snapshot: Snapshot, payload: unknown): SnapshotUpdate {
  if (!isRecord(payload)) {
    return fail("malformed");
  }
  if (Object.hasOwn(payload, "content")) {
    return applyFull(snapshot, payload);
  }
  if (Object.hasOwn(payload, "ops")) {
    return applyPatch(snapshot, payload);
  }
  return fail("malformed");
}

function applyFull(snapshot: Snapshot, payload: JsonObject): SnapshotUpdate {
  if (!isNonEmptyString(payload.page)) {
    return fail("malformed");
  }
  if (payload.page !== snapshot.page) {
    return fail("page");
  }
  if (typeof payload.version !== "number") {
    return fail("malformed");
  }
  if (!isPageEntries(payload.pages)) {
    return fail("malformed");
  }
  if (typeof payload.meta !== "string") {
    return fail("malformed");
  }
  if (!isNode(payload.content)) {
    return fail("malformed");
  }
  if (payload.contributions !== undefined && !Array.isArray(payload.contributions)) {
    return fail("malformed");
  }
  return {
    ok: true,
    snapshot: {
      pages: payload.pages,
      page: payload.page,
      meta: payload.meta,
      content: payload.content,
      version: payload.version,
      ...(payload.contributions === undefined ? {} : { contributions: payload.contributions }),
    },
  };
}

function applyPatch(snapshot: Snapshot, payload: JsonObject): SnapshotUpdate {
  if (!isNonEmptyString(payload.page)) {
    return fail("malformed");
  }
  if (payload.page !== snapshot.page) {
    return fail("page");
  }
  if (typeof payload.base !== "number") {
    return fail("malformed");
  }
  if (payload.base !== snapshot.version) {
    return fail("version");
  }
  if (typeof payload.version !== "number") {
    return fail("malformed");
  }
  if (!Array.isArray(payload.ops)) {
    return fail("malformed");
  }

  try {
    let root: unknown = snapshot;
    for (const op of payload.ops) {
      root = applyOp(root, op);
    }
    if (!isSnapshot(root)) {
      return fail("malformed");
    }
    return { ok: true, snapshot: { ...root, version: payload.version } };
  } catch (error) {
    if (error instanceof PatchError) {
      return fail("malformed");
    }
    throw error;
  }
}

/** 路径走不通（缺 key、下标越界、类型不对）或 op 不认识。 */
class PatchError extends Error {}

type Container = unknown[] | JsonObject;

function applyOp(root: unknown, op: unknown): unknown {
  if (!isRecord(op)) {
    throw new PatchError("op 必须是对象");
  }
  const path = op.path;
  if (!isPath(path)) {
    throw new PatchError("path 不合法");
  }

  switch (op.op) {
    case "set":
      if (!Object.hasOwn(op, "value")) {
        throw new PatchError("set 必须带 value");
      }
      return updateAt(root, path, (parent, key) => {
        writeChild(parent, key, op.value);
      });

    case "insert":
    case "remove": {
      const index = op.index;
      if (typeof index !== "number" || !Number.isInteger(index)) {
        throw new PatchError("index 必须是整数");
      }
      if (op.op === "insert" && !isNode(op.value)) {
        throw new PatchError("insert 的 value 必须是节点");
      }
      return updateAt(root, path, (parent, key) => {
        const items = readChild(parent, key);
        if (!Array.isArray(items)) {
          throw new PatchError("insert / remove 的 path 必须指向数组");
        }
        if (index < 0 || index > items.length || (op.op === "remove" && index === items.length)) {
          throw new PatchError("index 越界");
        }
        const copy = items.slice();
        if (op.op === "insert") {
          copy.splice(index, 0, op.value);
        } else {
          copy.splice(index, 1);
        }
        writeChild(parent, key, copy);
      });
    }

    default:
      throw new PatchError("未知 op");
  }
}

/**
 * 走到 path 的父容器，把最后一格交给 apply；沿途只复制这一条路径上的容器，
 * 没碰到的子树仍然是原快照里的对象（渲染端按节点引用 memo）。
 */
function updateAt(
  root: unknown,
  path: readonly PathPart[],
  apply: (parent: Container, key: PathPart) => void,
): unknown {
  if (path.length === 0) {
    throw new PatchError("path 不能是空的");
  }
  return updateStep(root, path, 0, apply);
}

function updateStep(
  current: unknown,
  path: readonly PathPart[],
  at: number,
  apply: (parent: Container, key: PathPart) => void,
): unknown {
  const key = path[at];
  if (key === undefined) {
    throw new PatchError("path 不合法");
  }
  const last = at === path.length - 1;

  if (Array.isArray(current)) {
    if (typeof key !== "number" || !Number.isInteger(key) || key < 0 || key >= current.length) {
      throw new PatchError("下标越界");
    }
    const copy = current.slice();
    if (last) {
      apply(copy, key);
    } else {
      copy[key] = updateStep(copy[key], path, at + 1, apply);
    }
    return copy;
  }

  if (isRecord(current)) {
    if (typeof key !== "string" || key.length === 0) {
      throw new PatchError("对象的路径必须是字符串");
    }
    if (!last && !Object.hasOwn(current, key)) {
      throw new PatchError("路径走不通");
    }
    const copy: JsonObject = { ...current };
    if (last) {
      apply(copy, key);
    } else {
      copy[key] = updateStep(copy[key], path, at + 1, apply);
    }
    return copy;
  }

  throw new PatchError("路径走不通");
}

function readChild(container: Container, key: PathPart): unknown {
  return Array.isArray(container) ? container[key as number] : container[String(key)];
}

function writeChild(container: Container, key: PathPart, value: unknown): void {
  if (Array.isArray(container)) {
    container[key as number] = value;
  } else {
    container[String(key)] = value;
  }
}

function fail(reason: "page" | "version" | "malformed"): SnapshotUpdate {
  return { ok: false, reason };
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPath(value: unknown): value is PathPart[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (part) =>
        (typeof part === "string" && part.length > 0) ||
        (typeof part === "number" && Number.isInteger(part) && part >= 0),
    )
  );
}

function isNode(value: unknown): value is Node {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.type === "string" && isRecord(value.props) && Array.isArray(value.children);
}

function isPageEntries(value: unknown): value is PageEntry[] {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every((entry) => {
    if (!isRecord(entry)) {
      return false;
    }
    if (!isNonEmptyString(entry.name) || typeof entry.label !== "string") {
      return false;
    }
    return (
      (entry.icon === undefined || typeof entry.icon === "string") &&
      (entry.count === undefined || typeof entry.count === "number")
    );
  });
}

function isSnapshot(value: unknown): value is Snapshot {
  if (!isRecord(value)) {
    return false;
  }
  if (value.contributions !== undefined && !Array.isArray(value.contributions)) {
    return false;
  }
  return (
    isPageEntries(value.pages) &&
    isNonEmptyString(value.page) &&
    typeof value.meta === "string" &&
    isNode(value.content) &&
    typeof value.version === "number"
  );
}
