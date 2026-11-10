"""进程入口：读配置 → 装插件 → 起 net。

整套东西里唯一不是插件的就是这个文件：它知道有哪些插件、按什么顺序装。
插件类本身由 boot 按 pyproject 里的入口点找。
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

from boot import build, load_config
from omora.core.log import Log, build_log, level_of, log_path
from omora.net import Net

ROOT = Path(__file__).resolve().parent.parent

SYSTEM_PLUGINS = (
    "store",
    "manager",
    "media",
    "ui",
    "audio",  # 捕捉拆成两个插件：没有麦克风只关音频，没有摄像头只关视频
    "video",
    "ideas",
    "projects",
    "requirements",
    "net",  # 最后一个：它一开就收帧，HTTP 媒体通道也跟着起
)


def main() -> int:
    config = load_config(ROOT / "config.ini", ROOT / "config.yaml")
    log = build_log(log_path(ROOT), level=level_of(os.environ.get("OMORA_LOG")))
    boot_log = log.child("boot")
    kernel = build(config, SYSTEM_PLUGINS, log=log)

    # 必须在 build 之后：认领是插件取配置时发生的
    for section in config.unclaimed():
        boot_log.warning("config.unclaimed", section=section)
    net: Net = kernel.resolve("net")
    try:
        asyncio.run(_run(net, boot_log))
    except KeyboardInterrupt:
        return 0
    return 0


async def _run(net: Net, log: Log) -> None:
    port = await net.serve()
    log.info("boot.started", ws=f"ws://{net.host}:{port}")
    if net.media_url is not None:
        log.info("boot.media.started", url=net.media_url)
    try:
        await asyncio.Event().wait()
    finally:
        await net.stop()


if __name__ == "__main__":
    raise SystemExit(main())