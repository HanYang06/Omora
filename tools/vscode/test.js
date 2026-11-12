"use strict";

/** 纯逻辑测试：不需要 VS Code，直接 node 跑。 */

const assert = require("node:assert");
const lib = require("./lib/keys");

let failed = 0;

function check(name, body) {
  try {
    body();
    console.log("PASS " + name);
  } catch (error) {
    failed += 1;
    console.error("FAIL " + name + ": " + error.message);
  }
}

const index = JSON.stringify({
  keys: [
    {
      key: "ideas.home.after_capture",
      declared_by: "ideas",
      declarations: [{ owner: "ideas", path: "packages/ideas/omora/ideas.py", line: 42 }],
      uses: [{ owner: "audio", path: "packages/audio/omora/audio.py", line: 7 }],
    },
    {
      key: "om.window.page",
      declared_by: "ui",
      declarations: [],
      uses: [],
    },
  ],
});

check("parseIndex 拿到键数组", () => {
  const keys = lib.parseIndex(index);
  assert.equal(keys.length, 2);
  assert.equal(keys[0].key, "ideas.home.after_capture");
});

check("parseIndex 拒绝坏数据", () => {
  assert.throws(() => lib.parseIndex("{}"));
  assert.throws(() => lib.parseIndex("[]"));
});

check("keyAt 在双引号里返回键", () => {
  const text = 'x = Slot(key="ideas.home.after_capture")';
  const offset = text.indexOf("after_capture");
  assert.equal(lib.keyAt(text, offset), "ideas.home.after_capture");
});

check("keyAt 在单引号里也认", () => {
  const text = "ui.contribute(ctx, 'ideas.home.after_capture', build)";
  assert.equal(lib.keyAt(text, text.indexOf("home")), "ideas.home.after_capture");
});

check("keyAt 不在字符串里返回 null", () => {
  const text = 'x = Slot(key="abc") + 1';
  assert.equal(lib.keyAt(text, text.indexOf("Slot")), null);
  assert.equal(lib.keyAt(text, text.length), null);
});

check("keyAt 不跨行猜", () => {
  const text = 'x = "abc"\ny = 1';
  assert.equal(lib.keyAt(text, text.indexOf("= 1")), null);
});

check("findKey 找不到给 undefined", () => {
  const keys = lib.parseIndex(index);
  assert.equal(lib.findKey(keys, "nope"), undefined);
  assert.equal(lib.findKey(keys, "om.window.page").declared_by, "ui");
});

check("hoverFor 带声明与使用位置", () => {
  const text = lib.hoverFor(lib.parseIndex(index)[0]);
  assert.match(text, /ideas\.home\.after_capture/);
  assert.match(text, /ideas\.py:42/);
  assert.match(text, /audio\.py:7/);
});

check("hoverFor 内置键说清楚", () => {
  const text = lib.hoverFor(lib.parseIndex(index)[1]);
  assert.match(text, /内置键/);
  assert.match(text, /还没有人来挂/);
});

check("definitionOf 取第一条声明，内置键给 null", () => {
  const keys = lib.parseIndex(index);
  assert.deepEqual(lib.definitionOf(keys[0]), {
    path: "packages/ideas/omora/ideas.py",
    line: 42,
  });
  assert.equal(lib.definitionOf(keys[1]), null);
});

check("listLines 一行一把键", () => {
  const lines = lib.listLines(lib.parseIndex(index));
  assert.equal(lines.length, 2);
  assert.match(lines[0], /ideas\.home\.after_capture/);
  assert.match(lines[0], /1 处使用/);
});

if (failed > 0) {
  console.error(failed + " 条失败");
  process.exitCode = 1;
} else {
  console.log("KEYS EXT OK");
}
