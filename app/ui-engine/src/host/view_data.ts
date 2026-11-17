/**
 * view.data → 单个 data 更新的最小 diff。
 *
 * 只有“恰好一个 source 变化”时才返回 payload；多 source / 删除 source / 形状不合法
 * 都返回 undefined，让调用方退回全量。
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 一个 source 的 view.data 条目 → data payload；不合法返回 undefined。 */
export function singleDataUpdate(
  oldData: Record<string, unknown>,
  newData: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const keys = new Set([...Object.keys(oldData), ...Object.keys(newData)]);
  const changed = [...keys].filter(
    (key) => JSON.stringify(oldData[key]) !== JSON.stringify(newData[key]),
  );
  if (changed.length !== 1) {
    return undefined;
  }
  const source = changed[0];
  if (source === undefined) {
    return undefined;
  }
  const entry = newData[source];
  if (!isRecord(entry) || !("revision" in entry)) {
    return undefined;
  }
  return { ...entry, kind: "data", owner: "view", source };
}
