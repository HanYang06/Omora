# 桌面壳（Electron）

## 为什么是 Electron

判据只有一条：**稳定**。壳的作用是替你回答"真实环境里它到底什么样"，壳本身
再出问题就是负资产。

- **Chromium 钉死在壳里**，不跟系统 WebView2 的版本走。环境变量被消掉，不是又加一个。
- **DevTools 就是浏览器那套**，不用额外配调试链路。
- **不引新语言**：主进程是 JS，和渲染引擎同一套工具链。

安装包大小不是选型依据。业务没跑通之前优化体积是提前优化；等业务稳定了再谈瘦身，
那时候换壳或者裁依赖都来得及。

## 结构

`app/shell/` 只有一个文件 `main.cjs`，做三件事：

1. 开窗口（1360×880，最小 960×640，底色调成桌面色，避免白闪）；
2. 装页面：开发时 `OMORA_DEV_URL` → vite dev server；发布时 → `app/ui-engine/dist/index.html`；
3. 给调试留口子：`OMORA_DEVTOOLS=1` 开 DevTools；`OMORA_SHOT` 截图后退出。

**它不起 Python 内核。** 开发时内核由 `omora dev` 起（和 vite 一起），壳只当
浏览器用；发布形态由壳拉起内核，是下一步的事。

## 开发

```bash
uv run omora dev --shell            # 内核 + 引擎 + 壳
uv run omora dev --shell --devtools # 顺带开 DevTools
pnpm install                                    # 第一次（根目录 workspace，装齐引擎与壳）
```

壳的输出并进同一条日志时间线（`[shell]` 前缀）；页面自己的日志照旧走 `log.write_many`。

## 这个环境里踩到的三个坑

1. **`ELECTRON_RUN_AS_NODE=1`**：某些编辑器 / CI 会设它，electron.exe 会退化成 node，
   主进程里 `require("electron")` 是 undefined。`dev.py` 起壳时剥掉这个变量。
2. **dev server 可能比壳晚起来**：`did-fail-load` 之后隔 400ms 重试，最多 40 次，
   否则停在白板上。
3. **截图的合成器**：`webContents.capturePage()` 在无 GPU 的会话里会抛
   `UnknownVizError`；退回 CDP `Page.captureScreenshot` 时默认 `fromSurface: true`
   只出半张图，要用 `fromSurface: false`。

## 验证壳在干活

`OMORA_SHOT=路径 uv run omora dev --shell` 会在页面加载后截图并退出，
同时把 `#root` / `.omora-app` / `.omora-split` 的尺寸和视口写进 `路径.json` ——
"页面是不是真的画出来了"不该靠猜。

三个配套开关：

| 变量                         | 作用                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `OMORA_CLICK=CSS 选择器`     | 截图前先点一下（验证交互后的画面，比如录制预览），点完等 1.5s                                        |
| `OMORA_SHOT_SURFACE=1`       | 用 surface 截图。默认走 renderer 截图，**视频帧是黑的**；要看画面必须开这个                          |
| `路径.json` 里的 `live` 字段 | `<video data-type="video-live">` 的 `videoWidth/readyState/paused/currentTime`，判断"是没流还是没播" |

第 5 个坑：**截图看不见视频**。渲染器侧截图拿不到视频层，会是一片黑，但这不代表
预览坏了——先看 `live` 的 `readyState=4 / paused=false`，再决定要不要开 surface。

## 下一步

- 打包：electron-builder，Windows 先做
- 壳拉起内核（发布形态）：`python.exe app/main.py` 子进程 + 端口约定
- 菜单、快捷键、窗口状态记忆
