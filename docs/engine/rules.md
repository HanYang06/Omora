# 规则：事件、数据与反应

> 状态：**已定与结构平级**；触发/效果闭集是【建议】。
> 依赖：[contract.md](contract.md)
> 相关：[collection.md](collection.md) · [updates.md](updates.md) · `runtime.md`（待写）

## 0. 一句话

结构回答“UI 长什么样”，规则回答“UI 怎么动”；两者平级，同属权威根树。

## 1. 为什么平级

如果行为藏在组件实现里，引擎就无法分析整棵树：谁响应什么、数据喂给谁、哪些规则冲突。把规则写进树里，引擎才能建规则索引、做静态诊断、做最小更新。

## 2. 触发闭集【建议】

| 触发        | 载荷              | 例子                 |
| ----------- | ----------------- | -------------------- |
| `event`     | 事件名 + 载荷     | 点击、提交、键盘     |
| `data`      | source + revision | 上传进度、条目变化   |
| `lifecycle` | mount / unmount   | 进入工作区、离开页面 |
| `route`     | 进/出页面         | 页面切换             |

## 3. 效果闭集【建议】

| 效果                        | 做什么                     |
| --------------------------- | -------------------------- |
| `update`                    | 改 props / 数据 / 局部状态 |
| `mount / unmount / replace` | 位置写操作                 |
| `set-state`                 | 改渲染端局部状态           |
| `navigate`                  | 路由                       |
| `dispatch`                  | 回来源/宿主处理            |
| `emit`                      | 发事件                     |

规则最终只能归结为 [contract.md](contract.md) 的三种写操作：位置、排布、内容。没有第五种。

## 4. 数据输入

- `in` 声明“我消费哪个数据源/路径”，引擎据此建绑定索引。
- 数据到达时：先按绑定更新值，再查 `reactions` 里 `on data` 的规则跑效果。
- 数据绑定本身可视为一条特殊反应（读值 → 改 props），但保留 `in` 是为了静态算出绑定关系、做最小更新。

## 5. 规则索引与确定性

- 引擎组合完成后建 `触发源 → [规则]` 索引。
- 同一规则在一次触发里只跑一次；同 id 的规则重复到达按替换处理。
- 规则执行顺序：树文档序 + 声明序；跨规则的副作用不保证顺序，需要顺序就合并成一条规则。
- 规则与目标都在同一次编译/链接里校验：目标不存在、越权、循环触发都是诊断。

## 6. 边界

**规则是数据，不是程序。**

- 不放条件表达式、循环、脚本；
- 需要“如果 A 且 B 且 C”的复杂逻辑，`dispatch` 回来源/宿主算完，再以数据或局部树回来；
- 否则格式会变成一门语言，引擎就退化成解释器。

## 7. 示例

```jsonc
{
  "id": "ideas.capture.audio",
  "kind": "ideas:tile",
  "reactions": [
    {
      "on": { "event": "click" },
      "do": [{ "effect": "dispatch", "action": "ideas.capture.audio" }],
    },
    {
      "on": { "data": "media.upload.7.done" },
      "do": [
        {
          "effect": "mount",
          "slot": "dendro.layer.toast",
          "node": { "kind": "dendro:text", "props": { "text": "已保存" } },
        },
      ],
    },
  ],
}
```

## 8. 未定

- 条件（when）要不要进格式；如果进，只允许闭集比较，不允许表达式；
- 规则优先级与覆盖；
- 跨来源 observe/intercept 的权限细节（见 [permissions.md](permissions.md)）。
