# 架构速览

> 权威来源：`../../../../docs/architecture/overview.md` 与 `../../../../docs/architecture/contracts.md`。本文件是压缩版，冲突时以 docs 为准。

## 一句话

两个小核心 + 一大堆插件：Python 内核管逻辑与状态，TypeScript 渲染器管界面，中间只有协议，没有共享内存。

## 分层

```
Presentation · TypeScript
  壳（窗口 / 布局 / 槽位） · Schema Renderer · 组件词表 · 沙箱 UI 宿主
        ▲ C1（私有，可随时破坏）
Kernel · Python
  服务容器 · 插件宿主 · 能力代理 · 执行单元 · 事件日志 · 事务存储
        ▲ C2（公开，语义化版本）
  L0 进程内 · L2 进程池 · L4 WASM 池
```

## 三份契约

| 契约 | 双方 | 兼容承诺 | 用途 |
|---|---|---|---|
| C1 | 内核 ↔ 前端 | 无 | 命令上行、事件下行 |
| C2 | 宿主 ↔ 插件 | 语义化版本 | 能力调用、生命周期 |
| C3 | 插件 ↔ 渲染器 | 版本化 + 能力探测 | 声明式 UI 节点树 |

## 四条铁律

1. 命令上行：UI 只发命令，不直接改状态。
2. 事件下行：内核产生事件，前端与插件消费。
3. UI 是投影：前端只持有内核状态的投影。
4. 无共享状态：跨边界只传数据，不传对象。

## 信任分层

| 层级 | 承载 | 默认用于 |
|---|---|---|
| L0 | 内核进程内，同语言，scope | 官方插件 |
| L1 | Worker / isolate | 大量第三方同语言插件 |
| L2 | 共享宿主进程池 | 异语言批次 |
| L3 | 独占进程 | 高风险或重型插件 |
| L4 | WASM 实例池 | 不可信、多语言 |
| L5 | 远程插件 | 服务器、团队共享 |

协议在 L0–L5 一致，插件可无损晋升，不改代码。

## 核心与插件的判定

三道测试，满足至少一条才是核心：

1. 引导性：插件加载前就必须存在。
2. 信任性：交给插件执行等于没有执行。
3. 契约性：它本身就是共享契约。

三条都不满足，一律插件。核心里出现业务概念就是边界破了。

## P0 模块地图

新增文件前先回答"它在哪一层"，再动手写。

| 位置 | 职责 | 一句话 |
|---|---|---|
| `kernel/context.py` | 作用域 | provide / inject / 生命周期，dispose 逆序 |
| `kernel/services.py` | 服务注册 | 按注册序拓扑解析，环在创建任何实例之前失败 |
| `kernel/store.py` | 存储 | SQLite + WAL + 嵌套事务 + 按模块版本化迁移 |
| `kernel/eventlog.py` | 事件日志 | append 分配单调 revision，范围读取与追赶 |
| `kernel/projection.py` | 投影 | 按类型折叠；未知事件跳过但 revision 照常前进 |
| `kernel/registry.py` | 命令表 | 命令与查询两个命名空间，随 scope 回收，零残留 |
| `kernel/runtime.py` | 装配 | `emit` 是唯一写入口：落库 → 折叠 → 扇出 |
| `kernel/host.py` | 插件宿主 | 发现 / 校验 / 激活 / 贡献 / 卸载 |
| `kernel/contract/c1.py` | C1 面 | 传输层只依赖这里的窄 Protocol |
| `kernel/contract/c2.py` | C2 面 | 清单校验与引擎版本兼容 |
| `kernel/transport/ws.py` | 传输 | JSON-RPC 2.0 over 本机 WebSocket |
| `kernel/ui/validate.py` | C3 校验 | 校验与降级两件事分开 |
| `web/rpc/` | C1 客户端 | 连接、重连、revision 追赶 |
| `web/store/projection.ts` | 投影 | 纯函数合并快照与事件 |
| `web/renderer/` | 渲染器 | type → 控件映射，未知类型降级 |
| `web/shell/` | 壳 | 两个槽位，只接收贡献 |

判据：**能在插件里做的，就不要放内核；能靠数据表达的，就不要写代码。**

## 相关 ADR

- `../../../../docs/decisions/0001-stack-and-runtime.md`
- `../../../../docs/decisions/0002-core-boundary.md`
- `../../../../docs/decisions/0003-unified-versioning.md`
- `../../../../docs/decisions/0004-plugin-boundary.md`
