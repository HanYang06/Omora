"""发布构建：把可运行的源码和构建好的渲染引擎打成一个 zip。

用法：uv run python scripts/build.py
产物：dist/omora-<version>.zip
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VERSION = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
DIST = ROOT / "dist"
STAGE = DIST / f"omora-{VERSION}"
ARCHIVE = DIST / f"omora-{VERSION}.zip"
UI_ENGINE = ROOT / "app" / "ui-engine"
EXCLUDE_PREFIXES = (".agents/", ".githooks/", ".github/")


def pnpm(*args: str) -> list[str]:
    if sys.platform == "win32":
        return ["cmd", "/c", "pnpm", *args]
    return ["pnpm", *args]


def run(argv: list[str]) -> None:
    subprocess.run(argv, cwd=ROOT, check=True)


def tracked_files() -> list[str]:
    result = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=ROOT,
        capture_output=True,
        check=True,
    )
    return [name for name in result.stdout.decode("utf-8").split("\0") if name]


def working_tree_dirty() -> bool:
    result = subprocess.run(
        ["git", "status", "--porcelain", "--untracked-files=no"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )
    return bool(result.stdout.strip())


def build_ui() -> None:
    run(pnpm("--dir", "app/ui-engine", "build"))
    if not (UI_ENGINE / "dist" / "index.html").is_file():
        raise SystemExit("前端构建没有产出 app/ui-engine/dist/index.html")


def copy_source(stage: Path) -> None:
    for relative in tracked_files():
        if relative.startswith(EXCLUDE_PREFIXES):
            continue
        target = stage / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / relative, target)


def copy_ui(stage: Path) -> None:
    shutil.copytree(UI_ENGINE / "dist", stage / "app" / "ui-engine" / "dist")


def write_archive(stage: Path) -> None:
    if ARCHIVE.exists():
        ARCHIVE.unlink()
    with zipfile.ZipFile(ARCHIVE, "w", zipfile.ZIP_DEFLATED) as bundle:
        for path in sorted(stage.rglob("*")):
            if path.is_file():
                bundle.write(path, path.relative_to(DIST).as_posix())


def main() -> int:
    parser = argparse.ArgumentParser(description="发布构建")
    parser.add_argument(
        "--allow-dirty",
        action="store_true",
        help="允许在工作区有未提交改动时构建（默认拒绝）",
    )
    args = parser.parse_args()

    if working_tree_dirty() and not args.allow_dirty:
        print("工作区有未提交改动；发布构建要求干净（或加 --allow-dirty）。")
        return 1

    if STAGE.exists():
        shutil.rmtree(STAGE)
    STAGE.mkdir(parents=True)
    build_ui()
    copy_source(STAGE)
    copy_ui(STAGE)
    write_archive(STAGE)

    files = sum(1 for path in STAGE.rglob("*") if path.is_file())
    size = ARCHIVE.stat().st_size / 1024 / 1024
    print(f"已构建 {ARCHIVE.relative_to(ROOT).as_posix()}：{files} 个文件，{size:.1f} MiB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
