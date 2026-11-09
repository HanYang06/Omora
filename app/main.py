"""进程入口：读配置 → 装插件 → 起 net。

整套东西里唯一不是插件的就是这个文件：它知道有哪些插件、按什么顺序装。
插件类本身由 boot 按 pyproject 里的入口点找。
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from boot import build, load_config
from omora.net import Net

ROOT = Path(__file__).resolve().parent.parent

SYSTEM_PLUGINS = (
    "store",
    "manager",
    "media",
    "ui",
    "ideas",
    "projects",
    "requirements",
    "net",  # 最后一个：它一开就收帧
)


def main() -> int:
    config = load_config(ROOT / "config.ini", ROOT / "config.yaml")
    kernel = build(config, SYSTEM_PLUGINS)

    for section in config.unclaimed():
        print(f"配置里这一段没有插件认领: [{section}]", file=sys.stderr)

    net: Net = kernel.resolve("net")
    try:
        asyncio.run(_run(net))
    except KeyboardInterrupt:
        return 0
    return 0


async def _run(net: Net) -> None:
    port = await net.serve()
    print(f"omora 内核已起：ws://{net.host}:{port}", flush=True)
    try:
        await asyncio.Event().wait()
    finally:
        await net.stop()


if __name__ == "__main__":
    raise SystemExit(main())
