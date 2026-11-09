"""类型检查：workspace 的包 + 组装根 + 测试。

mypy 一次只能用一种目标（包 / 文件），所以分两次跑。
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

PACKAGES = [
    "omora.core",
    "omora.sdk",
    "omora.plugins.store",
    "omora.plugins.media",
    "omora.plugins.ui",
    "omora.plugins.ideas",
    "omora.plugins.projects",
    "omora.plugins.requirements",
    "omora.plugins.net",
]

FILES = [
    "app/boot.py",
    "app/main.py",
    "app/boot/tests",
    "app/core/tests",
    "app/sdk/tests",
    "app/packages/ideas/tests",
    "app/packages/media/tests",
    "app/packages/net/tests",
    "app/packages/store/tests",
    "app/packages/ui/tests",
]


def _mypy(args: list[str]) -> int:
    return subprocess.run(
        [sys.executable, "-m", "mypy", *args],
        cwd=ROOT,
        check=False,
    ).returncode


def main() -> int:
    packages = [item for name in PACKAGES for item in ("-p", name)]
    if _mypy(packages) != 0:
        return 1
    return _mypy(FILES)


if __name__ == "__main__":
    raise SystemExit(main())
