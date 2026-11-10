# 插件管理器设计

`manager` 是系统插件：持有插件清单、条件检查和开关。它不碰内核——装、卸、名单
都走 boot 提供的 `host` 服务；开关存在 store 的 `settings` collection 里，
`config.ini` 只提供默认值、仍然只读。

位置：`app/packages/manager/`，入口点 `manager = "omora.manager:ManagerPlugin"`。

## 1. 边界

- 内核还是宿主：`manager` 不 import `omora.core`，也不拿 `Kernel`。
- boot 先装 store + manager，再把 `host` 交给 manager，其余插件由 manager 按清单装。
- 插件之间只靠服务名；manager 只认 `host`、`store`、`ui` 三个服务。
- 生命周期只有一份：manager 的 `phase` + `reason`。插件自己的健康状态不进清单。

## 2. host 服务

boot 在 manager 之前装一个最小的 `host` 插件，把下面这份接口挂到服务表：

| 方法                    | 作用                           |
| ----------------------- | ------------------------------ |
| `manifest()`            | boot 声明的有序插件名          |
| `names()`               | 现在装着的插件                 |
| `install(name)`         | 按入口点构造并装一个插件       |
| `uninstall(name)`       | 卸一个插件                     |
| `has_service(name)`     | 检查 `requires` 用的服务在不在 |
| `default_enabled(name)` | config.ini 给的默认开关        |

`host` 自己不是系统插件，不在 manifest 里，也不出现在清单中。

## 3. 清单

清单顺序 = boot 的 `SYSTEM_PLUGINS`。每个名字的元数据来自入口点模块旁边那份
`pyproject.toml` 的 `[tool.omora]`。`manager.inventory()` 返回：

```json
{
  "platform": "win32",
  "capabilities": ["microphone"],
  "reported": true,
  "plugins": [
    {
      "name": "ideas",
      "version": "0.1.0",
      "description": "灵感页",
      "bootstrap": false,
      "listed": true,
      "default_enabled": true,
      "enabled": true,
      "phase": "active",
      "reason": null,
      "conditions": { "platforms": [], "capabilities": [], "requires": ["store", "media", "ui"] }
    }
  ]
}
```

`phase` 只有五个值：`pending`（还没轮到装）、`loading`（正在装）、`active`（跑着）、
`failed`（装的时候抛了）、`disabled`（不该开，或不满足条件）。`reason` 是
`{code, message}`；`code` 稳定，`message` 给人看。

## 4. 条件

四个键都写在每个 package 的 `[tool.omora]`：

```toml
[tool.omora]
platforms = ["win32", "darwin", "linux"]  # sys.platform 词汇；空 = 全平台
capabilities = ["microphone"]             # 客户端能力；空 = 不需要
listed = true                             # 默认 GUI 列表是否出现
requires = ["store", "media"]             # 需要的服务名
```

- `platforms`：当前 `sys.platform` 不在里面 → `unsupported-platform`。
- `capabilities`：客户端上报的能力里没有 → `missing-capability`。没上报过等于没有，
  所以在引擎连上之前，声明能力的插件默认是关的。
- `requires`：服务表里没有 → `missing-service`。manifest 顺序要保证依赖先装。
- `listed` 只影响默认列表是否展示，不影响装载；管理页始终列全部（管理视角要完整）。
- 判断顺序：平台 → 能力 → 服务 → 用户开关。条件不满足优先于开关：开了也不装，
  并把原因写进 `reason`。

未知的 `[tool.omora]` 键忽略（以后加字段不至于让旧 manager 起不来）；已知键类型
不对是 `invalid-metadata`，那一行 `phase = failed`，不影响别的插件。

## 5. 开关

- 生效开关 = store 里 `settings` 的那一行，没有就用 config.ini 的 `enabled`。
- `settings`：`{plugin: text, enabled: bool}`，`plugin` 有索引；由 manager 建。
- `set_enabled(name, enabled)`：写一行，然后整体重算。`store` / `manager` 是启动项，
  不允许关；未知名字 `LookupError`；类型不对 `TypeError`。
- 关掉 → `host.uninstall`，内核按账本逆序撤销服务与页面，零残留。
- 装上失败 → `enabled` 仍是 true，`phase = failed`，`reason = install-failed`；
  其余插件继续装。

## 6. 能力通道（TS → Python）

客户端能力（麦克风 / 摄像头）只有引擎知道。引擎在连接 open 之后发一次普通 call：

```json
{
  "id": "1",
  "type": "call",
  "target": "manager",
  "method": "report_capabilities",
  "args": { "capabilities": ["microphone", "camera"] }
}
```

- 不新增帧类型，走现有协议。
- 引擎侧只负责上报；枚举设备是 capture 的 `devices.ts`，manager 不探测硬件。
- 多客户端部署：Python 是 server，能力是每个客户端各自的事实。manager 的
  `capabilities` 只记最后一次上报（给设置页看），是否满足条件按"本次进程里见过"
  算——后一个没有摄像头的客户端不会把别人的摄像头插件关掉。每客户端的界面门禁
  归引擎自己。

## 7. boot 顺序

1. 读并合并配置，把每个 manifest 名字的 `enabled` 都认领掉（没人认领的段要能报出来）。
2. 装 `host`。
3. 装启动项：`store`、`manager`（按 manifest 顺序）。
4. manager 按 manifest 装其余插件；已经在跑的跳过。

没有 manager（manifest 里没有，或被配置关掉）时，boot 回到自己按序装，应用以
降级形态起来：没有清单和设置页，但已有插件照常工作。

启动项不能被开关关掉：关掉 store，manager 没有持久化；关掉 manager，就没有人
管清单了。

## 8. 设置页

manager 通过 ui 插件登记 `plugins` 页（导航标签「插件」）：每行一个插件，显示
阶段、描述、条件、原因和「启用 / 禁用」。启动项显示「启动项」，不给按钮。

- ui 被关掉时页面不登记（降级）；ui 重新打开后 manager 重算时自动补登记。
- 页面是普通 ui 页，快照形状不变。

## 9. 测试

- `app/packages/manager/tests/`：清单、阶段、平台/能力/服务条件、开关持久化、
  卸载清理、设置页、元数据校验。
- `app/boot/tests/test_boot_manager.py`：boot 顺序、配置只当默认、manager 关掉的降级路径。
- `app/boot/tests/test_loop.py`：真 WebSocket 上 inventory / 上报 / 开关。
- 门禁：`.github/workflows/ci.yml`（命令清单见 `docs/design/ci.md`）。

## 10. 未做

- 运行后（生态）插件的运行期安装 / 卸载：清单和数据模型已经留好，但装包和扫描
  运行后目录是下一步。
- 每个客户端的独立能力状态、插件市场、后台健康检查、配置界面。
- 清单重排：顺序仍然只在 boot 的代码列表里。
