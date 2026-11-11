# Omora Keys（VS Code 扩展）

读仓库根的 `keys.json`，给 Python 插件源码里的界面键加悬浮与跳转。

## 怎么用

1. 在仓库根生成索引：`uv run python scripts/keys.py`（CI 会校验它是最新的）。
2. 把 `tools/vscode` 作为扩展开发目录加载：

   ```bash
   code --extensionDevelopmentPath=tools/vscode .
   ```

   或者把整个目录拷到 `~/.vscode/extensions/omora-keys`。

3. 打开任意插件源码，把光标放进一个键字符串里：

   ```python
   ui.contribute(ctx, "ideas.home.after_capture", build)
   ```

   悬浮显示声明者、声明位置、谁在用；F12 跳到声明处。

4. 命令面板：`Omora: 列出界面键` / `Omora: 重新读 keys.json`。

## 边界

- **零依赖**：只用 `vscode` 与 Node 自带模块，没有构建步骤、没有 npm 依赖。
- **只认单行字符串字面量**：键都写在一行里；跨行的情况不提示，也不猜。
- **编辑器那一层没有自动化验证**：CI 只跑 `node tools/vscode/test.js`（纯逻辑 11 条），
  VS Code 里加载与悬浮的实际表现要人工看一次。
