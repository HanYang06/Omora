# 组合：编译与链接

> 状态：**决定报错**；机制【建议】。S2 已落第一版链接器（形状校验、多轮挂载、order/容量/replace 与诊断）和构建期门禁；`before/after`、权限、slot 排序策略、按 kind 的 props schema 未实现。
> 依赖：[contract.md](contract.md) · [addressing.md](addressing.md)
> 相关：[updates.md](updates.md) · [permissions.md](permissions.md) · `runtime.md`（待写）

## 0. 一句话

组合不是尽力拼装，是**编译/链接**：要么产出唯一权威根树，要么因 error 不产出新树。

## 1. 输入：局部树与来源

- 输入是多个**局部树**；来源可以是插件、worker、独立进程、远程服务、AI 生成、测试 fixture。
- 来源不是引擎的概念，插件只是其中一种 adapter；组合契约只关心 owner、局部树、落点、顺序、权限。
- 局部树的最小契约：

| 字段                     | 说明                                             |
| ------------------------ | ------------------------------------------------ |
| `root`                   | 局部树根节点（页面根或片段根）                   |
| `mountAt`                | 挂到哪个 slot id（页面根可声明自己的 page slot） |
| `order` / `before/after` | 同 slot 上的相对顺序                             |
| `owner` / `seq`          | 归属与同一来源内的声明序                         |
| `replace`                | 是否允许替换同 slot 的既有内容（受权限约束）     |

## 2. 两个 pass

1. **类型检查**（每个局部树各自）：kind 是否存在、props/events/bind/state/layout 是否符合 schema、动作引用、绑定路径类型。
2. **链接**（跨局部树）：目标 slot 是否存在、id 是否重复、权限、同 slot 顺序是否明确、单槽容量、成环、规则目标、数据源生产者。

产出只有两种：**权威根树 + 诊断**，或者**因 error 不产出新树**。

## 3. 顺序模型

- 每个挂载声明 `order`，或相对约束 `before/after`。
- 同 slot 上**不同 owner** 的挂载 `order` 相同 → `E-SLOT-AMBIGUOUS`；不按 owner 字典序兜底。
- 同一 owner 往同 slot 挂多份，按自己的声明序号排，不算歧义。
- 已落：`order` / `seq` / 容量 / `replace` / 多轮链接 / 确定性排序。未实现：`before/after` 相对约束、slot owner 声明的排序策略。
- 单槽（`capacity: one`）被多于一个挂载 → `E-SLOT-CAPACITY`。
- slot owner 可以显式声明排序策略（例如同 order 按 owner 排），但这是**声明出来的契约**，不是引擎偷着帮忙。

## 4. 诊断

| 码                 | 含义                             | 状态                               |
| ------------------ | -------------------------------- | ---------------------------------- |
| `E-PAYLOAD`        | payload / Slot 形状不合法        | S2 已落（文档原表没有，S2 补的码） |
| `E-SLOT-AMBIGUOUS` | 同 slot 相对顺序未约定           | S2 已落                            |
| `E-SLOT-CAPACITY`  | 单槽被多挂 / 超出 capacity       | S2 已落                            |
| `E-ID-DUPLICATE`   | 全局 id 冲突                     | S2 已落                            |
| `E-TARGET-MISSING` | 落点不存在                       | S2 已落                            |
| `E-CYCLE`          | 组合成环                         | S2 已落                            |
| `E-PERMISSION`     | 越权挂载/替换/更新               | 未实现                             |
| `E-TEMPLATE`       | 模板/条目 schema 不匹配          | 未实现                             |
| `W-BINDING-ORPHAN` | 绑定暂时没有生产者（允许，警告） | 未实现                             |
| `W-RULE-DEAD`      | 规则永不触发（警告）             | 未实现                             |

诊断要带现场：注册贡献时记录声明来源（文件/行），诊断里给出 owner、slot、两个冲突声明的位置与 help。

## 5. 时机

- **构建期**：随包发布的系统来源，在 CI 里跑编译/链接，冲突在 CI 红，不产出发布物。
- **运行期**：后装/后连的来源，组合时跑同一个检查器；有 error 就拒绝该来源、保留上一棵好的根树、把诊断摆出来（fail closed），应用不倒。

## 6. 根树归属

- 根树是引擎的；引擎拥有、引擎可派生修改（实例化列表、派生 id、规范化布局、按 id 协调）。
- 来源发来的是**变更请求**；引擎校验后应用，不合法就拒绝并诊断。
- 根树任何时刻都合法、可导出、可审计。

## 7. 局部树的生命周期

- 引擎维护局部树注册表；来源更新/卸载局部树时重算它影响的那一块。
- 局部树被撤，挂在它声明的 slot 下的其他来源的贡献一起撤（级联），各记一条日志。
- 局部树先到、目标 slot 后到：允许挂起，多轮链接；最终落不下就是死引用，记诊断丢弃。

## 8. 不变量

1. 同一组局部树，任意到达顺序，根树与诊断完全一致。
2. 歧义必错：同 slot 同位置且无显式顺序 → 必定编译失败。
3. 编译失败不产出半成品根树。
4. 死引用、越权、重复 id 都有确定诊断码。

## 9. S2 实现（已落）

- **代码**：`app/ui-engine/src/link/` —— `parse.ts` 第一遍（复用 `contract/document.ts` 的 Slot 校验）、`link.ts` 第二遍（多轮挂载 + 排序 + 容量 + replace）、`scaffold.ts`（窗口骨架）；构建期门禁在 `build/vite-linker.ts`。
- **输入**：`{kind: "local-trees", seq, trees: [{owner, root, mountAt, order, seq, replace?}]}`；Python 序列化在 `app/sdk/omora/sdk/local_tree.py`，两侧共用 `app/sdk/tests/fixtures/local-trees.json`。
- **输出**：`{ok: true, tree, ids}` 或 `{ok: false, diagnostics}`。有 error 不产树（原子）；不改入参；诊断按 `(code, owner, slot, path, message)` 排序，与到达顺序无关。
- **多轮**：落点可以由另一棵局部树引入；骨架只给 `dendro.window.nav` / `dendro.window.page`，其余槽位由来源补齐。
- **门禁**：`vite build` / dev server 的 `buildStart` 用共享 fixture 跑一遍 `link`，冲突让构建失败；链接器与门禁不进客户端 bundle。共享 fixture 的序列化由 Python 测试逐字段钉住。
- **未接**：运行时仍是 legacy 贡献模型（`legacy/render/compose.ts`）；按 kind 的 props/events schema、权限、`before/after`、`E-TEMPLATE`、孤儿绑定/死规则警告、`static_ui.py` 的编译门禁升级都还没做。
- **测试**：每个已落诊断码至少一条失败路径；乱序不变、重复到达幂等、失败不产树、入参不变、`ids` 覆盖 `collection.templates`、replace/容量行为；`vite buildStart` 对合法 fixture 通过、对冲突 fixture 抛错。

## 10. S4 来源宿主与链接期权限（已落）

- **链接期权限**（`src/link/link.ts`）：`link(base, payload, {requesterFor})` 在挂载阶段按目标 slot 检查 `mount`（`replace` 挂载检查 `replace`）；越权 → `E-PERMISSION`，整次链接失败不产树。缺省 requester = 系统来源（全放行，现有门禁不变）。base 先经 `parseDocument` 归一，扁平 grant 才能被检查器读到。
- **来源宿主**（`src/host/sources.ts`）：`SourceHost` 维护 owner → 局部树注册表，登记/移除后重新链接；来源被撤时，挂在其 slot 下的其他来源树按 `E-TARGET-MISSING` 级联撤掉并记诊断；非死引用错误（歧义/容量/环）整次回滚、保留上一棵好树（fail closed）；dispose 走生命周期账本。
- **未接**：来源热更新只重算整组链接（还没做增量重链）、Producer Host 与 EngineRuntime/网络帧的接线、来源的 activate/rollback 账本。
