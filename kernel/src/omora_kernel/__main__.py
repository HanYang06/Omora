"""内核入口：uv run python -m omora_kernel --database .omora/dev.sqlite"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path
from typing import cast

from .app import KernelApp
from .transport.ws import C1Server

LOGGER = logging.getLogger("omora")


async def serve(database: Path, plugins: Path, host: str, port: int) -> None:
    database.parent.mkdir(parents=True, exist_ok=True)
    app = KernelApp(database=database, plugins_dir=plugins)
    activated = await app.start()
    LOGGER.info("已激活插件: %s", ", ".join(activated) if activated else "(无)")
    server = C1Server(app.c1_handlers(), host=host, port=port)
    await server.start()
    LOGGER.info("Omora 内核已启动: ws://%s:%s", host, server.port)
    try:
        await asyncio.Event().wait()
    finally:
        await server.stop()
        await app.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Omora 内核")
    parser.add_argument("--database", default=".omora/dev.sqlite", help="SQLite 文件路径")
    parser.add_argument("--plugins", default="plugins", help="插件目录")
    parser.add_argument("--host", default="127.0.0.1", help="监听地址")
    parser.add_argument("--port", type=int, default=8765, help="监听端口;0 表示由系统分配")
    arguments = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    try:
        asyncio.run(
            serve(
                Path(cast("str", arguments.database)),
                Path(cast("str", arguments.plugins)),
                cast("str", arguments.host),
                cast("int", arguments.port),
            )
        )
    except KeyboardInterrupt:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
