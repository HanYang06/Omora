"""类型检查：workspace 的包 + 组装根 + 测试。

mypy 一次只能用一种目标（包 / 模块 / 文件），所以分开跑。
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

PACKAGES = ["omora.cli", "omora.core", "omora.sdk"]

MODULES = [
    "omora.store",
    "omora.manager",
    "omora.media",
    "omora.ui",
    "omora.audio",
    "omora.video",
    "omora.ideas",
    "omora.projects",
    "omora.requirements",
    "omora.net",
]

FILES = [
    "app/boot.py",
    "app/main.py",
    "app/boot/tests",
    "app/core/tests",
    "app/sdk/tests",
    "app/packages/audio/tests",
    "app/packages/ideas/tests",
    "app/packages/manager/tests",
    "app/packages/media/tests",
    "app/packages/net/tests",
    "app/packages/store/tests",
    "app/packages/ui/tests",
    "app/packages/video/tests",
]


def _mypy(args: list[str]) -> int:
    return subprocess.run(
        [sys.executable, "-m", "mypy", *args],
        cwd=ROOT,
        check=False,
    ).returncode


def main() -> int:
    if _mypy([item for name in PACKAGES for item in ("-p", name)]) != 0:
        return 1
    if _mypy([item for name in MODULES for item in ("-m", name)]) != 0:
        return 1
    return _mypy(FILES)


if __name__ == "__main__":
    raise SystemExit(main())
