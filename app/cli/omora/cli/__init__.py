"""omora：开发入口。

现在只有一个子命令：`omora dev`（内核 + 渲染引擎 + 可选桌面壳）。
"""

from __future__ import annotations

import sys

from . import dev as _dev


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if args and args[0] in {"-h", "--help"}:
        print("用法：omora dev [--kernel|--web|--shell] [--devtools] [-v]")
        return 0
    if args and args[0] == "dev":
        args = args[1:]
    elif args and not args[0].startswith("-"):
        print(f"未知子命令：{args[0]}", file=sys.stderr)
        return 2
    return _dev.main(args)


__all__ = ["main"]
