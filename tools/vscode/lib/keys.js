"use strict";

/**
 * 键索引的纯函数：解析、找光标下的键、悬浮文案、定义位置、列表文案。
 *
 * 编辑器那一层（vscode API）只做接线，逻辑全放这里——这样能直接用 node 跑，不依赖编辑器。
 */

/** keys.json 文本 → 键数组；坏数据抛错，不吞。 */
function parseIndex(text) {
  const data = JSON.parse(text);
  if (data === null || typeof data !== "object" || !Array.isArray(data.keys)) {
    throw new Error("keys.json 缺少 keys 数组");
  }
  return data.keys;
}

/**
 * 光标位置所在字符串字面量的内容；不在同一行的字符串里就给 null。
 *
 * 只认单行字面量：键都写在一行里，跨行的情况宁可不提示，也不猜错位置。
 */
function keyAt(text, offset) {
  const limit = Math.max(0, Math.min(offset, text.length));
  const before = text.lastIndexOf("\n", Math.max(0, limit - 1)) + 1;
  const newline = text.indexOf("\n", limit);
  const lineEnd = newline === -1 ? text.length : newline;
  const line = text.slice(before, lineEnd);
  const local = limit - before;

  let quote = null;
  let start = -1;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote === null) {
      if (ch === '"' || ch === "'") {
        quote = ch;
        start = i;
      }
      continue;
    }
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === quote) {
      if (local > start && local <= i) {
        return line.slice(start + 1, i);
      }
      quote = null;
      start = -1;
    }
  }
  return null;
}

/** 按名字找一把键；没有就 undefined。 */
function findKey(keys, key) {
  return keys.find((entry) => entry.key === key);
}

/** 悬浮文案：声明者、声明位置、使用者；内置键没有声明位置。 */
function hoverFor(entry) {
  const lines = ["**" + entry.key + "**", "", "声明者：`" + entry.declared_by + "`"];
  if (entry.declarations.length > 0) {
    lines.push("", "声明：");
    for (const hit of entry.declarations) {
      lines.push("- `" + hit.path + ":" + hit.line + "`");
    }
  } else {
    lines.push("", "内置键：引擎或页面自己用，不在插件源码里声明。");
  }
  if (entry.uses.length > 0) {
    lines.push("", "使用者：");
    for (const hit of entry.uses) {
      lines.push("- `" + hit.path + ":" + hit.line + "`（" + hit.owner + "）");
    }
  } else {
    lines.push("", "还没有人来挂。");
  }
  return lines.join("\n");
}

/** 跳转目标：优先第一条声明；内置键没有声明就给 null。 */
function definitionOf(entry) {
  const first = entry.declarations[0];
  if (first === undefined) {
    return null;
  }
  return { path: first.path, line: first.line };
}

/** 快速选择里的一行。 */
function listLine(entry) {
  return entry.key + "  ← " + entry.declared_by + "  （" + entry.uses.length + " 处使用）";
}

/** 全部键的列表文案。 */
function listLines(keys) {
  return keys.map(listLine);
}

module.exports = { parseIndex, keyAt, findKey, hoverFor, definitionOf, listLine, listLines };
