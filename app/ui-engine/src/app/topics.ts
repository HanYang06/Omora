/**
 * 订阅集合的差：快照声明了什么，客户端就订什么。
 *
 * 引擎不写死插件 topic：页面把要订的 topic 写进快照，这里只算该补订 / 该退订的。
 */
export function topicsToSync(
  current: readonly string[],
  next: readonly string[],
): { add: string[]; remove: string[] } {
  const before = new Set(current);
  const after = new Set(next);
  return {
    add: next.filter((topic) => !before.has(topic)),
    remove: current.filter((topic) => !after.has(topic)),
  };
}
