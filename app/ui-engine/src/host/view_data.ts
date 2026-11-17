/**
 * view.data → data 更新列表。
 *
 * 每个变化的 source 产出一个 payload；删除 source / 形状不合法返回 undefined，
 * 让调用方退回全量。调用方逐个提交，最后用一次空 ops 升版本。
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** view.data diff → data payload 列表；任何不合法返回 undefined。 */
export function dataUpdates(
  oldData: Record<string, unknown>,
  newData: Record<string, unknown>,
): Record<string, unknown>[] | undefined {
  const keys = new Set([...Object.keys(oldData), ...Object.keys(newData)]);
  const payloads: Record<string, unknown>[] = [];
  for (const source of keys) {
    if (!(source in newData)) {
      return undefined;
    }
    if (JSON.stringify(oldData[source]) === JSON.stringify(newData[source])) {
      continue;
    }
    const entry = newData[source];
    if (!isRecord(entry) || !("revision" in entry)) {
      return undefined;
    }
    payloads.push({ ...entry, kind: "data", owner: "view", source });
  }
  return payloads;
}
