"""体量预算：文档与代码的文件行数上限。

唯一真相是仓库根的 budget.json；CI 只读这一份。
合并顺序是 defaults < suffixes < paths < names，最后按文件名兜底，
所以测试文件不会被按目录的预算压回去。
"""

from __future__ import annotations

import argparse
import fnmatch
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "budget.json"

SKIP_DIRS = {
    ".git",
    ".venv",
    ".agents",
    "node_modules",
    "dist",
    "build",
    "__pycache__",
    ".pytest_cache",
    ".ruff_cache",
    ".mypy_cache",
}
DOC_FILES = ("README.md", "AGENTS.md")
DOC_ROOT = Path("docs")
CODE_ROOTS = ("app", "scripts")
CODE_SUFFIXES = {".py", ".ts", ".tsx"}


@dataclass(frozen=True)
class Problem:
    path: str
    message: str

    def __str__(self) -> str:
        return f"{self.path}: {self.message}"


class Budget:
    """budget.json 的解析结果。"""

    def __init__(self, config: Path = CONFIG) -> None:
        raw: Any = json.loads(config.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise SystemExit("budget.json 顶层必须是对象")
        self.defaults = _limits(raw.get("defaults"), "defaults")
        self.suffixes = {
            str(key).lower(): _limits(value, f"suffixes.{key}")
            for key, value in _mapping(raw.get("suffixes"), "suffixes").items()
        }
        self.paths = {
            str(key).strip("/"): _limits(value, f"paths.{key}")
            for key, value in _mapping(raw.get("paths"), "paths").items()
        }
        self.names = {
            str(key): _limits(value, f"names.{key}")
            for key, value in _mapping(raw.get("names"), "names").items()
        }

    def limit(self, relative: str, suffix: str) -> int | None:
        merged = dict(self.defaults)
        merged.update(self.suffixes.get(suffix.lower(), {}))
        for prefix in sorted(self.paths):
            if relative == prefix or relative.startswith(prefix + "/"):
                merged.update(self.paths[prefix])
        name = Path(relative).name
        for pattern in sorted(self.names):
            if fnmatch.fnmatch(name, pattern):
                merged.update(self.names[pattern])
        return merged.get("fileLines")


def _mapping(raw: Any, where: str) -> dict[str, Any]:
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise SystemExit(f"budget.json 的 {where} 必须是对象")
    return {str(key): value for key, value in raw.items()}


def _limits(raw: Any, where: str) -> dict[str, int]:
    if not isinstance(raw, dict) or not raw:
        raise SystemExit(f"budget.json 的 {where} 必须是非空对象")
    limits: dict[str, int] = {}
    for key, value in raw.items():
        if not isinstance(key, str) or not isinstance(value, int) or value <= 0:
            raise SystemExit(f"budget.json 的 {where} 含非法条目: {key!r}")
        limits[key] = value
    return limits


def _relative(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def _docs_files() -> list[Path]:
    found = [ROOT / name for name in DOC_FILES if (ROOT / name).is_file()]
    docs = ROOT / DOC_ROOT
    if docs.is_dir():
        found.extend(sorted(docs.rglob("*.md")))
    return found


def _code_files() -> list[Path]:
    found: list[Path] = []
    for root in CODE_ROOTS:
        base = ROOT / root
        if not base.is_dir():
            continue
        for path in base.rglob("*"):
            if not path.is_file():
                continue
            relative = path.relative_to(ROOT)
            if any(part in SKIP_DIRS for part in relative.parts):
                continue
            if path.suffix.lower() in CODE_SUFFIXES:
                found.append(path)
    return sorted(found)


def check(files: list[Path], budget: Budget) -> list[Problem]:
    problems: list[Problem] = []
    for path in files:
        relative = _relative(path)
        limit = budget.limit(relative, path.suffix)
        if limit is None:
            continue
        lines = len(path.read_text(encoding="utf-8", errors="replace").splitlines())
        if lines > limit:
            problems.append(Problem(relative, f"{lines} 行，超过预算 {limit}"))
    return problems


def _report(name: str, problems: list[Problem]) -> bool:
    if not problems:
        print(f"PASS {name}")
        return True
    print(f"FAIL {name} ({len(problems)})")
    for problem in problems[:50]:
        print(f"  {problem}")
    if len(problems) > 50:
        print(f"  ... 还有 {len(problems) - 50} 条")
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description="体量预算：文档与代码的文件行数上限")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--docs", action="store_true", help="只查文档")
    group.add_argument("--code", action="store_true", help="只查代码")
    args = parser.parse_args()

    budget = Budget()
    passed = True
    if not args.code:
        passed = _report("budget.docs", check(_docs_files(), budget)) and passed
    if not args.docs:
        passed = _report("budget.code", check(_code_files(), budget)) and passed
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
