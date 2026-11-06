#!/usr/bin/env python3
"""Omora 统一门禁。本地与 CI 必须跑同一条命令：uv run python scripts/check.py"""

from __future__ import annotations

import io
import re
import shutil
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from typing import TextIO, cast

from budget import Budget, check_file_budget, check_python_structure
from common import CODE_SUFFIXES, ROOT, TEXT_SUFFIXES, Problem, iter_files, read_text
from test_quality import check_test_quality


def _force_utf8(stream: TextIO) -> None:
    cast(io.TextIOWrapper, stream).reconfigure(encoding="utf-8", errors="replace")


_force_utf8(sys.stdout)
_force_utf8(sys.stderr)

TODO_ROOTS = ["kernel/src", "kernel/tests", "plugins", "web/src"]
PRINT_ROOTS = ["kernel/src", "plugins", "web/src"]

CONFLICT_RE = re.compile(r"^(<{7}|={7}|>{7})")
TODO_RE = re.compile(r"\bTODO\b(?!\(#\d+\))")
BREAKPOINT_RE = re.compile(r"\bbreakpoint\s*\(")
LINK_RE = re.compile(r"!?\[[^\]]*\]\(([^)\s]+)")


SKILLS_ROOT = ROOT / ".agents" / "skills"
PROJECT_SKILLS = ("omora-project", "omora-testing", "omora-git")
FRONTMATTER_RE = re.compile(r"\A---\n(.*?)\n---\n", re.DOTALL)


def check_conflicts() -> list[Problem]:
    problems: list[Problem] = []
    for path in iter_files(CODE_SUFFIXES):
        for lineno, line in enumerate(read_text(path).splitlines(), 1):
            if CONFLICT_RE.match(line):
                problems.append(Problem(path, "合并冲突标记残留", lineno))
    return problems


def check_todos() -> list[Problem]:
    problems: list[Problem] = []
    for rel in TODO_ROOTS:
        base = ROOT / rel
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in CODE_SUFFIXES:
                continue
            for lineno, line in enumerate(read_text(path).splitlines(), 1):
                if TODO_RE.search(line):
                    problems.append(Problem(path, "未完成标记必须写成 (#issue) 形式", lineno))
    return problems


def check_debug_breakpoints() -> list[Problem]:
    problems: list[Problem] = []
    for rel in PRINT_ROOTS:
        base = ROOT / rel
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in CODE_SUFFIXES:
                continue
            for lineno, line in enumerate(read_text(path).splitlines(), 1):
                if BREAKPOINT_RE.search(line):
                    problems.append(Problem(path, "禁止提交 breakpoint", lineno))
    return problems


def check_whitespace() -> list[Problem]:
    problems: list[Problem] = []
    for path in iter_files(TEXT_SUFFIXES):
        if path.suffix.lower() == ".md":
            continue
        text = read_text(path)
        for lineno, line in enumerate(text.splitlines(), 1):
            if line != line.rstrip():
                problems.append(Problem(path, "行尾多余空格", lineno))
        if text and not text.endswith("\n"):
            problems.append(Problem(path, "文件必须以换行结尾"))
    return problems


def first_match(pattern: str, text: str) -> str | None:
    match = re.search(pattern, text, re.MULTILINE)
    return match.group(1) if match else None


def check_versions() -> list[Problem]:
    problems: list[Problem] = []
    expected = read_text(ROOT / "VERSION").strip()
    toml_sources = [
        (ROOT / "pyproject.toml", "根 pyproject"),
        (ROOT / "sdk" / "pyproject.toml", "sdk"),
        (ROOT / "kernel" / "pyproject.toml", "kernel"),
        (ROOT / "plugins" / "ideas" / "pyproject.toml", "plugins/ideas"),
    ]
    for path, label in toml_sources:
        if not path.exists():
            continue
        actual = first_match(r'^version\s*=\s*"([^"]+)"', read_text(path))
        if actual != expected:
            problems.append(Problem(path, f"{label} 版本 {actual} 与 VERSION {expected} 不一致"))
    package = ROOT / "web" / "package.json"
    if package.exists():
        actual = first_match(r'"version"\s*:\s*"([^"]+)"', read_text(package))
        if actual != expected:
            problems.append(Problem(package, f"web 版本 {actual} 与 VERSION {expected} 不一致"))
    init = ROOT / "kernel" / "src" / "omora_kernel" / "__init__.py"
    if init.exists():
        actual = first_match(r'^__version__\s*=\s*"([^"]+)"', read_text(init))
        if actual != expected:
            problems.append(Problem(init, f"__version__ {actual} 与 VERSION {expected} 不一致"))
    return problems


def check_docs_links() -> list[Problem]:
    problems: list[Problem] = []
    candidates = [ROOT / "README.md", ROOT / "readme.md", ROOT / "AGENTS.md"]
    docs = ROOT / "docs"
    if docs.exists():
        candidates.extend(sorted(docs.rglob("*.md")))
    seen: set[Path] = set()
    for path in candidates:
        if not path.exists() or path in seen:
            continue
        seen.add(path)
        for lineno, line in enumerate(read_text(path).splitlines(), 1):
            for match in LINK_RE.finditer(line):
                target = match.group(1)
                if target.startswith(("http://", "https://", "#", "mailto:")):
                    continue
                clean = target.split("#", 1)[0]
                if clean == "":
                    continue
                if not (path.parent / clean).resolve().exists():
                    problems.append(Problem(path, f"链接目标不存在: {target}", lineno))
    return problems


def check_secrets() -> list[Problem]:
    problems: list[Problem] = []
    for name in (".env", ".env.local"):
        path = ROOT / name
        if path.exists():
            problems.append(Problem(path, "禁止提交密钥文件"))
    return problems


def _check_skill_frontmatter(skill: Path, expected: str) -> list[Problem]:
    text = read_text(skill)
    match = FRONTMATTER_RE.match(text)
    if match is None:
        return [Problem(skill, "缺少 YAML frontmatter")]
    front = match.group(1)
    problems: list[Problem] = []
    name = first_match(r"^name:\s*(\S+)\s*$", front)
    if name != expected:
        problems.append(Problem(skill, f"name 必须是 {expected}，实际 {name}"))
    description = first_match(r"^description:\s*(.+)$", front)
    if description is None or len(description) < 40:
        problems.append(Problem(skill, "description 太短，无法可靠触发"))
    return problems


def _check_skill_links(skill_dir: Path) -> list[Problem]:
    problems: list[Problem] = []
    for path in sorted(skill_dir.rglob("*.md")):
        for lineno, line in enumerate(read_text(path).splitlines(), 1):
            for found in LINK_RE.finditer(line):
                target = found.group(1)
                if target.startswith(("http://", "https://", "#", "mailto:")):
                    continue
                clean = target.split("#", 1)[0]
                if clean and not (path.parent / clean).resolve().exists():
                    problems.append(Problem(path, f"链接目标不存在: {target}", lineno))
    return problems


def _check_one_skill(name: str, budget: Budget) -> list[Problem]:
    skill_dir = SKILLS_ROOT / name
    skill = skill_dir / "SKILL.md"
    if not skill.exists():
        return [Problem(skill, "项目 skill 缺失")]
    text = read_text(skill)
    problems = _check_skill_frontmatter(skill, name)
    limit = budget.limits_for(skill).get("fileLines")
    if limit is not None and len(text.splitlines()) > limit:
        problems.append(Problem(skill, f"{len(text.splitlines())} 行，超过预算 {limit}"))
    problems.extend(_check_skill_links(skill_dir))
    return problems


def _check_adr_drift() -> list[Problem]:
    problems: list[Problem] = []
    text = "\n".join(
        read_text(path) for name in PROJECT_SKILLS for path in (SKILLS_ROOT / name).rglob("*.md")
    )
    for adr in sorted((ROOT / "docs" / "decisions").glob("*.md")):
        if adr.name not in text:
            problems.append(Problem(adr, "新增 ADR 未同步到项目 skill"))
    return problems


def check_project_skills(budget: Budget) -> list[Problem]:
    problems: list[Problem] = []
    for name in PROJECT_SKILLS:
        problems.extend(_check_one_skill(name, budget))
    problems.extend(_check_adr_drift())
    return problems


def all_checks() -> list[tuple[str, Callable[[], list[Problem]]]]:
    budget = Budget()
    return [
        ("hygiene.conflicts", check_conflicts),
        ("hygiene.todos", check_todos),
        ("hygiene.breakpoints", check_debug_breakpoints),
        ("hygiene.whitespace", check_whitespace),
        ("hygiene.versions", check_versions),
        ("hygiene.docs-links", check_docs_links),
        ("hygiene.secrets", check_secrets),
        ("skill.project", lambda: check_project_skills(budget)),
        ("tests.behavior", check_test_quality),
        ("budget.files", lambda: check_file_budget(budget)),
        ("budget.python", lambda: check_python_structure(budget)),
    ]


def venv_tool(name: str) -> str:
    suffix = ".exe" if sys.platform == "win32" else ""
    candidate = Path(sys.executable).parent / f"{name}{suffix}"
    if candidate.exists():
        return str(candidate)
    found = shutil.which(name)
    if found is None:
        raise SystemExit(f"缺少工具 {name}；先运行 uv sync")
    return found


def pnpm(*args: str) -> list[str]:
    if sys.platform == "win32":
        return ["cmd", "/c", "pnpm", *args]
    return ["pnpm", *args]


def tool_stages() -> list[tuple[str, list[str], Path]]:
    uv = shutil.which("uv")
    if uv is None:
        raise SystemExit("缺少 uv")
    stages: list[tuple[str, list[str], Path]] = [
        ("py.format", [venv_tool("ruff"), "format", "--check", "."], ROOT),
        ("py.lint", [venv_tool("ruff"), "check", "."], ROOT),
        ("py.types", [venv_tool("pyright")], ROOT),
        ("py.test", [sys.executable, "-m", "pytest", "-q"], ROOT),
        ("py.arch", [venv_tool("lint-imports")], ROOT),
        ("py.build", [uv, "build", "kernel", "--out-dir", ".build"], ROOT),
    ]
    web = ROOT / "web"
    if (web / "package.json").exists():
        stages.extend(
            [
                ("web.format", pnpm("exec", "prettier", "--check", "."), web),
                ("web.lint", pnpm("exec", "eslint", "."), web),
                ("web.types", pnpm("exec", "tsc", "--noEmit"), web),
                ("web.test", pnpm("exec", "vitest", "run"), web),
                ("web.build", pnpm("exec", "tsc", "-p", "tsconfig.build.json"), web),
            ]
        )
    return stages


def run_stage(name: str, argv: list[str], cwd: Path) -> bool:
    shown = " ".join(argv)
    try:
        result = subprocess.run(
            argv,
            cwd=cwd,
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
    output = ((result.stdout or "") + (result.stderr or "")).strip()
    print("\n".join("  " + line for line in output.splitlines()[-40:]))
    return False


def main() -> int:
    args = sys.argv[1:]
    checks = all_checks()
    if "--list" in args:
        for name, _ in checks:
            print(name)
        for name, _, _ in tool_stages():
            print(name)
        return 0

    failures = 0
    for name, check in checks:
        problems = check()
        if problems:
            failures += 1
            print(f"FAIL {name} ({len(problems)})")
            for problem in problems[:50]:
                print(f"  {problem}")
            if len(problems) > 50:
                print(f"  ... 还有 {len(problems) - 50} 条")
        else:
            print(f"PASS {name}")

    if "--skip-tools" not in args:
        for name, argv, cwd in tool_stages():
            if not run_stage(name, argv, cwd):
                failures += 1
                break

    print()
    if failures == 0:
        print("门禁全绿。")
        return 0
    print(f"门禁失败：{failures} 项。")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
