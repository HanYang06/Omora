"""体量预算：文档与代码的文件行数分档。

唯一真相是仓库根的 budget.json；CI 只读这一份。

每个范围只给一个可接受上限（fileLines），再按百分比分档：
- 不超过警告线（上限 × warnPercent）：合格，静默通过；
- 警告线与阻断线之间：超过健康尺度，报告 WARN，不挡门禁；
- 超过阻断线（上限 × blockPercent）：超长，报告 FAIL 并让门禁失败。

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

DEFAULT_WARN_PERCENT = 85
DEFAULT_BLOCK_PERCENT = 120

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
CODE_ROOTS = ("app", "packages", "scripts")
CODE_SUFFIXES = {".py", ".ts", ".tsx"}


@dataclass(frozen=True)
class Tier:
    """一个范围的三个刻度：可接受上限、警告线、阻断线。"""

    max: int
    warn: int
    block: int

    @classmethod
    def of(cls, max_lines: int, warn_percent: int, block_percent: int) -> Tier:
        return cls(
            max=max_lines,
            warn=max_lines * warn_percent // 100,
            block=max_lines * block_percent // 100,
        )


@dataclass(frozen=True)
class Problem:
    path: str
    lines: int
    tier: Tier
    level: str

    def __str__(self) -> str:
        if self.level == "fail":
            return (
                f"{self.path}: {self.lines} 行，超过阻断线 {self.tier.block}"
                f"（上限 {self.tier.max}）"
            )
        return (
            f"{self.path}: {self.lines} 行，超过警告线 {self.tier.warn}"
            f"（上限 {self.tier.max}，阻断线 {self.tier.block}）"
        )


class Budget:
    """budget.json 的解析结果。"""

    def __init__(self, config: Path = CONFIG) -> None:
        raw: Any = json.loads(config.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise SystemExit("budget.json 顶层必须是对象")
        self.warn_percent, self.block_percent = _tiers(raw.get("tiers"))
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

    def tier(self, relative: str, suffix: str) -> Tier | None:
        merged = dict(self.defaults)
        merged.update(self.suffixes.get(suffix.lower(), {}))
        for prefix in sorted(self.paths):
            if relative == prefix or relative.startswith(prefix + "/"):
                merged.update(self.paths[prefix])
        name = Path(relative).name
        for pattern in sorted(self.names):
            if fnmatch.fnmatch(name, pattern):
                merged.update(self.names[pattern])
        max_lines = merged.get("fileLines")
        if max_lines is None:
            return None
        return Tier.of(max_lines, self.warn_percent, self.block_percent)


def _tiers(raw: Any) -> tuple[int, int]:
    if raw is None:
        return DEFAULT_WARN_PERCENT, DEFAULT_BLOCK_PERCENT
    if not isinstance(raw, dict):
        raise SystemExit("budget.json 的 tiers 必须是对象")
    warn = raw.get("warnPercent", DEFAULT_WARN_PERCENT)
    block = raw.get("blockPercent", DEFAULT_BLOCK_PERCENT)
    for name, value in (("warnPercent", warn), ("blockPercent", block)):
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise SystemExit(f"budget.json 的 tiers.{name} 必须是正整数")
    if warn >= block:
        raise SystemExit("budget.json 的 tiers.warnPercent 必须小于 blockPercent")
    return warn, block


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


def _relative(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def _docs_files(root: Path) -> list[Path]:
    found = [root / name for name in DOC_FILES if (root / name).is_file()]
    docs = root / DOC_ROOT
    if docs.is_dir():
        found.extend(sorted(docs.rglob("*.md")))
    return found


def _code_files(root: Path) -> list[Path]:
    found: list[Path] = []
    for name in CODE_ROOTS:
        base = root / name
        if not base.is_dir():
            continue
        for path in base.rglob("*"):
            if not path.is_file():
                continue
            relative = path.relative_to(root)
            if any(part in SKIP_DIRS for part in relative.parts):
                continue
            if path.suffix.lower() in CODE_SUFFIXES:
                found.append(path)
    return sorted(found)


def check(files: list[Path], budget: Budget, root: Path = ROOT) -> list[Problem]:
    problems: list[Problem] = []
    for path in files:
        relative = _relative(path, root)
        tier = budget.tier(relative, path.suffix)
        if tier is None:
            continue
        lines = len(path.read_text(encoding="utf-8", errors="replace").splitlines())
        if lines > tier.block:
            problems.append(Problem(relative, lines, tier, "fail"))
        elif lines > tier.warn:
            problems.append(Problem(relative, lines, tier, "warn"))
    return problems


def _print_problems(heading: str, problems: list[Problem]) -> None:
    print(f"{heading} ({len(problems)})")
    for problem in problems[:50]:
        print(f"  {problem}")
    if len(problems) > 50:
        print(f"  ... 还有 {len(problems) - 50} 条")


def _report(name: str, problems: list[Problem]) -> bool:
    failures = [problem for problem in problems if problem.level == "fail"]
    warnings = [problem for problem in problems if problem.level == "warn"]
    if not problems:
        print(f"PASS {name}")
        return True
    if failures:
        _print_problems(f"FAIL {name}", failures)
    if warnings:
        _print_problems(f"WARN {name}", warnings)
    return not failures


def run(
    *, root: Path = ROOT, config: Path | None = None, docs: bool = True, code: bool = True
) -> int:
    budget = Budget(config if config is not None else root / "budget.json")
    passed = True
    if docs:
        passed = _report("budget.docs", check(_docs_files(root), budget, root)) and passed
    if code:
        passed = _report("budget.code", check(_code_files(root), budget, root)) and passed
    return 0 if passed else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="体量预算：文档与代码的文件行数分档")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--docs", action="store_true", help="只查文档")
    group.add_argument("--code", action="store_true", help="只查代码")
    args = parser.parse_args(argv)
    return run(docs=not args.code, code=not args.docs)


if __name__ == "__main__":
    raise SystemExit(main())
