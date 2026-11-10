"""相对链接检查：README、AGENTS、docs 与项目 skill 里的本地链接必须存在。

用法：uv run python scripts/docs_links.py
"""

from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parent.parent
SKIP_PREFIXES = ("http://", "https://", "mailto:", "#", "data:")
LINK_RE = re.compile(r"!?\[[^\]]*\]\(([^)\s]+)")


def _files() -> list[Path]:
    found = [ROOT / name for name in ("README.md", "AGENTS.md") if (ROOT / name).is_file()]
    docs = ROOT / "docs"
    if docs.is_dir():
        found.extend(sorted(docs.rglob("*.md")))
    for skill in sorted((ROOT / ".agents" / "skills").glob("omora-*")):
        if skill.is_dir():
            found.extend(sorted(skill.rglob("*.md")))
    return found


def _target(source: Path, raw: str) -> Path | None:
    target = unquote(raw.strip("<>"))
    if not target or target.startswith(SKIP_PREFIXES):
        return None
    clean = target.split("#", 1)[0].split("?", 1)[0]
    if not clean:
        return None
    if clean.startswith("/"):
        return ROOT / clean.lstrip("/")
    return source.parent / clean


def check() -> list[str]:
    problems: list[str] = []
    for path in _files():
        text = path.read_text(encoding="utf-8", errors="replace")
        relative = path.relative_to(ROOT).as_posix()
        for lineno, line in enumerate(text.splitlines(), 1):
            for match in LINK_RE.finditer(line):
                resolved = _target(path, match.group(1))
                if resolved is not None and not resolved.exists():
                    problems.append(f"{relative}:{lineno}: 链接目标不存在: {match.group(1)}")
    return problems


def main() -> int:
    problems = check()
    if not problems:
        print("PASS docs.links")
        return 0
    print(f"FAIL docs.links ({len(problems)})")
    for problem in problems[:50]:
        print("  " + problem)
    if len(problems) > 50:
        print(f"  ... 还有 {len(problems) - 50} 条")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
