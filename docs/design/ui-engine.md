# 渲染引擎设计

位置：`app/ui-engine/`。职责：把节点树画出来，把交互发回去。它不持有真相。

## 1. 技术

TypeScript + React + Vite。

## 2. 结构

```
src/
  main.tsx        挂载
  connection.ts   WebSocket：请求 / 响应按 id 配对
  renderer.tsx    节点树 → React
  components.tsx  组件表（v0：column / row / text / button）
  types.ts        帧与节点类型
```

## 3. 连接

- 连 net 插件提供的端点；地址由 net 的配置决定。
- 请求 `{id, target, method, args}`；响应按 `id` 配对成 Promise。
- 未连接或断开：页面显示状态，不发请求。
- v0 不做重连与超时。

## 4. 数据流

1. 连上 → `render({view: "main"})` → `result` 是节点数组 → `setState`。
2. 渲染：map 节点 → React。
3. 点按钮：`props.on_click` 是 handler id → `event({handler, payload: {}})` → `result` 是新的节点数组 → `setState`。
4. 整棵树替换；v0 不做 diff。

## 5. 组件

| type | props | 渲染 |
|---|---|---|
| column | — | 纵向 flex |
| row | — | 横向 flex |
| text | text、kind? | span；`kind` 只映射样式类（v0 只有 title / 默认） |
| button | text、on_click | button；点击发事件 |

- 未知 `type` → 占位框 + `console.warn`。
- 没有子节点的 `children` 也得是数组。

## 6. 状态

- 只持有两样：当前节点数组、连接状态。
- 不缓存真相：数据在 Python 侧，这里只有当前这一棵树。

## 7. 错误

- 错误帧：`console.error`，保留旧树，不改界面。
- 渲染异常：v0 不加错误边界；崩了刷新。

## 8. 不变量

- 不认识 Python 服务之外的领域。
- 不做业务判断：点按钮就发事件，不自己改数据。
- 不 import Python 侧任何东西。
- 只认 `{type, props, children}` 与 handler id。
- 只跟 net 插件说话；net 是系统插件，不属于内核。

## 9. 没做的

- TS 插件宿主（接管整个界面的那一层）。
- 局部更新 / diff。
- 输入框与组件本地状态。
- 重连、请求超时、多客户端。
- 样式系统与设计 token。
