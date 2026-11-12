# 权限：能力 × 主体

> 状态：**概念已定**；S4 已落薄层：检查器 + 运行期 ops/data 检查（E-PERMISSION）；链接期检查、`observe`/`intercept`、审计未做。形态是【建议】，具体角色/等级模型推迟。
> 依赖：[contract.md](contract.md) · [composition.md](composition.md)
> 相关：[addressing.md](addressing.md) · [rules.md](rules.md)

## 0. 本质

权限回答一个问题：**来源 A 是否希望被 B/C/D/E/F 修改，以及允许改哪些面。**

它不是二元开关，而是“能力 × 主体”的集合；它也覆盖“拦截组件信息/动作”这类钩子。

## 1. 能力

| 能力        | 意思                                    |
| ----------- | --------------------------------------- |
| `read`      | 看见这个 Slot 的结构/数据               |
| `mount`     | 往它的槽里挂东西                        |
| `replace`   | 整块换掉它                              |
| `update`    | 改它的 props/数据                       |
| `remove`    | 删它                                    |
| `observe`   | 监听它的事件/信息流（“拦截信息”的影子） |
| `intercept` | 在动作送达前改写（钩子；v1 只保留名字） |

## 2. 主体与 grant

`grant` 声明在 Slot 上；主体可以是 `owner` / `any` / `role:<name>` / `owner:<id>` / `tier:<system|signed|user>`。

线上形状是**扁平能力表**（能力名直接作为键）；解析后引擎内部归一成 `{capabilities: {...}}`，Python 的 `Grant.to_json` 与 TS `parseDocument` 都以扁平形状为准：

```jsonc
"grant": {
  "read":      ["tier:system", "role:viewer"],
  "mount":     ["owner", "omora.manager"],
  "update":    ["owner", "omora.manager"],
  "replace":   ["owner", "omora.manager"],
  "remove":    ["owner"],
  "observe":   ["tier:system"],
  "intercept": []
}
```

## 3. 默认分层

- 系统来源（同包、受信）默认全能力；
- owner 对自己的子树全能力；
- 生态/运行后来源默认无能力，只能靠显式 `grant`；
- 当前没有运行后来源，所以这层实际是“格式里有、检查器跑通、默认全放行”。

## 4. 检查点

- **组合/链接期**：claimant 静态已知时检查；越权 → `E-PERMISSION`。
- **运行期**：动态请求再查一次；拒绝该次变更，根树不变。
- 数据：谁能发布到某个 source、谁能订阅，同样按能力检查。

## 5. 全寻址 ≠ 可介入

- 引擎内部对所有 Slot 全寻址，这是运行时能力；
- 外部来源的可见地址空间 = 被 `grant` 暴露的 slot；
- 写对 id 不等于有权限；闸门在引擎 API 上，不在“猜 id”上。

## 6. 不是安全边界

进程内的 TS/Python 来源能绕过引擎 API，所以权限目前是**协作/一致性契约，不是安全边界**。真正的隔离要等进程化/沙箱/信任模型。

## 7. 未定

- 角色与等级的注册、解析与变更（运行时登录态）；
- `intercept` 的实现与防环；
- 权限声明的继承与覆盖规则；
- 权限检查的观测与审计日志。

## 8. S4 实现（已落）

- **检查器**（`app/ui-engine/src/runtime/permissions.ts`）：`Capability` / `Requester {owner, tiers?, roles?}` / `SYSTEM_REQUESTER`；`can` 依 §3 默认分层与 §2 token 求值；`checkPermission` 产出带现场（owner/slot）的 `E-PERMISSION`。
- **运行期接线**：`applyOps(state, batch, {requester})` 按 op 语义检查（update→update；mount→mount；replace→replace；unmount→父 remove；move→旧父 remove + 目标 mount），拒绝整批原子失败；`applyData(..., {requester})` 对集合消费者/标量绑定消费者检查 update，拒绝时文档与 data 都不变。缺省 requester = 系统来源（全放行），现有行为不变。
- **会话/引擎**：`applySessionOps` 接受 requester 并透传给树 op；`EngineRuntime` 的 `EngineOptions.requester` 统一传给 ops/data。
- **未接**：链接/组合期检查、`observe`/`intercept`、数据 source 级发布/订阅权限、`applyFull` 的权限检查、审计日志；本层不是安全边界（§6）。
