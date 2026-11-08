"""Omora 统一门禁：本地和 CI 跑同一条命令。

用法：uv run python scripts/check.py
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TAIL_LINES = 40


def pnpm(*args: str) -> list[str]:
    if sys.platform == "win32":
        return ["cmd", "/c", "pnpm", *args]
    return ["pnpm", *args]


def stages() -> list[tuple[str, list[str]]]:
    if shutil.which("pnpm") is None:
        raise SystemExit("缺少 pnpm；先安装 pnpm")
    return [
        ("budget", [sys.executable, str(ROOT / "scripts" / "budget.py")]),
        ("docs.links", [sys.executable, str(ROOT / "scripts" / "docs_links.py")]),
        ("py.test", [sys.executable, "-m", "pytest", "-q"]),
        ("py.lint", [sys.executable, "-m", "ruff", "check", "."]),
        ("py.types", [sys.executable, "-m", "mypy", "app"]),
        ("ui.test", pnpm("--dir", "app/ui-engine", "test", "--run")),
        ("ui.build", pnpm("--dir", "app/ui-engine", "build")),
    ]


def run_stage(name: str, argv: list[str]) -> bool:
    shown = " ".join(argv)
    try:
        result = subprocess.run(
            argv,
            cwd=ROOT,
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            check=False,
        )
    except OSError as exc:
        print(f"FAIL {name}: 无法启动 {shown}: {exc}")
        return False
    if result.returncode == 0:
        print(f"PASS {name}")
        return True
    print(f"FAIL {name}: {shown}")
    output = (result.stdout + result.stderr).strip()
    for line in output.splitlines()[-TAIL_LINES:]:
        print("  " + line)
    return False


def main() -> int:
    if "--list" in sys.argv[1:]:
        for name, _ in stages():
            print(name)
        return 0
    for name, argv in stages():
        if not run_stage(name, argv):
            print("\n门禁失败。")
            return 1
    print("\n门禁全绿。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
