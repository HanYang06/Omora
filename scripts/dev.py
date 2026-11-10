"""兼容入口：真正的启动器在 omora.cli.dev（用 `uv run omora dev`）。

留这个文件是为了不打断肌肉记忆和老文档。
"""

from __future__ import annotations

from omora.cli.dev import main

if __name__ == "__main__":
    raise SystemExit(main())
