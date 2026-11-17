"""Check the active work queue and keep roadmap/changelog separate.

- docs/todo.md: only open work; every item needs owner: and next:.
- docs/roadmap.md: direction only; no "done" section.
- docs/changelog.md: completed history; must exist.

Run: uv run python scripts/todo.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TODO = ROOT / "docs" / "todo.md"
ROADMAP = ROOT / "docs" / "roadmap.md"
CHANGELOG = ROOT / "docs" / "changelog.md"
SECTIONS = ("## Now", "## Next", "## Blocked")
ITEM = re.compile(r"^- \[ \] .+")
DONE_HEADING = re.compile(r"^##+\s*(已完成|Done)\b")


def check_todo(text: str) -> list[str]:  # noqa: PLR0912 —— 逐行格式检查
    errors: list[str] = []
    lines = text.splitlines()
    title = next((line.strip() for line in lines if line.strip()), "")
    if title != "# TODO":
        errors.append("docs/todo.md 必须以 # TODO 开头")
    current: str | None = None
    seen: set[str] = set()
    counts = dict.fromkeys(SECTIONS, 0)
    for number, raw in enumerate(lines, start=1):
        line = raw.rstrip()
        if line.startswith("## "):
            if line not in SECTIONS:
                errors.append(f"docs/todo.md:{number} 未知 section: {line}")
            current = line
            seen.add(line)
            continue
        if line.startswith(("- [x]", "- [X]")):
            errors.append(f"docs/todo.md:{number} 已完成项必须移到 changelog")
            continue
        if line.startswith("- ["):
            if current not in SECTIONS:
                errors.append(f"docs/todo.md:{number} 条目不在 Now/Next/Blocked 下")
            if ITEM.match(line) is None:
                errors.append(f"docs/todo.md:{number} 条目必须是 - [ ] ...")
            if "owner:" not in line:
                errors.append(f"docs/todo.md:{number} 缺少 owner:")
            if "next:" not in line:
                errors.append(f"docs/todo.md:{number} 缺少 next:")
            if current in counts:
                counts[current] += 1
            continue
        if line.startswith("- "):
            errors.append(f"docs/todo.md:{number} 非 checkbox 条目")
    for section in SECTIONS:
        if section not in seen:
            errors.append(f"docs/todo.md 缺少 {section}")
        elif counts[section] == 0:
            errors.append(f"docs/todo.md 的 {section} 不能为空")
    return errors


def check_roadmap(text: str) -> list[str]:
    errors: list[str] = []
    for number, line in enumerate(text.splitlines(), start=1):
        if DONE_HEADING.match(line):
            errors.append(f"docs/roadmap.md:{number} 不能有完成记录，完成项进 changelog")
    return errors


def main() -> int:
    errors: list[str] = []
    if not TODO.is_file():
        errors.append("缺少 docs/todo.md")
    else:
        errors.extend(check_todo(TODO.read_text(encoding="utf-8")))
    if not ROADMAP.is_file():
        errors.append("缺少 docs/roadmap.md")
    else:
        errors.extend(check_roadmap(ROADMAP.read_text(encoding="utf-8")))
    if not CHANGELOG.is_file():
        errors.append("缺少 docs/changelog.md")
    if errors:
        print("FAIL docs/todo")
        for error in errors:
            print("  " + error)
        return 1
    print("PASS docs/todo")
    return 0


if __name__ == "__main__":
    sys.exit(main())
