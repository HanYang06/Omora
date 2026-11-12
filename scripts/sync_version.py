"""把根目录 VERSION 同步到所有 package 元数据。

系统插件不单独定版本：版本号只有一个，属于软件。
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VERSION_FILE = ROOT / "VERSION"
PACKAGES = ROOT / "packages"

VERSION_LINE = re.compile(r'^version = "[^"]*"$', re.MULTILINE)


def current_version() -> str:
    return VERSION_FILE.read_text(encoding="utf-8").strip()


def pyproject_paths() -> list[Path]:
    return [
        ROOT / "pyproject.toml",
        ROOT / "app" / "core" / "pyproject.toml",
        ROOT / "app" / "sdk" / "pyproject.toml",
        *sorted(PACKAGES.glob("*/pyproject.toml")),
    ]


def json_paths() -> list[Path]:
    return [
        ROOT / "package.json",
        ROOT / "app" / "ui-engine" / "package.json",
        *sorted(PACKAGES.glob("*/package.json")),
    ]


def sync_pyproject(path: Path, version: str) -> bool:
    text = path.read_text(encoding="utf-8")
    updated = VERSION_LINE.sub(f'version = "{version}"', text, count=1)
    if updated == text:
        return False
    path.write_text(updated, encoding="utf-8", newline="\n")
    return True


def sync_json(path: Path, version: str) -> bool:
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("version") == version:
        return False
    data["version"] = version
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n"
    )
    return True


def main() -> int:
    version = current_version()
    changed = [
        str(path) for path in pyproject_paths() if path.exists() and sync_pyproject(path, version)
    ]
    changed.extend(str(path) for path in json_paths() if path.exists() and sync_json(path, version))
    if changed:
        print(f"已同步到 {version}:")
        for path in changed:
            print("  " + path)
    else:
        print(f"已经是 {version}，不需要改。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
