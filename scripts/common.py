"""门禁共享工具：路径、文件遍历、问题模型。"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SKIP_DIRS = {
    ".git",
    ".venv",
    "node_modules",
    "dist",
    ".build",
    "__pycache__",
    ".ruff_cache",
    ".pytest_cache",
    ".pyright",
    ".import_linter_cache",
    "build",
    ".agents",
    ".omora",
}
SKIP_NAMES = {"uv.lock", "pnpm-lock.yaml", "skills-lock.json"}
CODE_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".mjs", ".cjs"}
TEXT_SUFFIXES = CODE_SUFFIXES | {".json", ".toml", ".yml", ".yaml", ".css", ".html", ".md", ".txt"}
EXTRA_NAMES = {"VERSION", ".gitignore", ".gitattributes", ".editorconfig"}


@dataclass(frozen=True)
class Problem:
    path: Path
    message: str
    line: int | None = None

    def __str__(self) -> str:
        try:
            rel = self.path.relative_to(ROOT).as_posix()
        except ValueError:
            rel = str(self.path)
        if self.line is None:
            return f"{rel}: {self.message}"
        return f"{rel}:{self.line}: {self.message}"


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def iter_files(suffixes: set[str]) -> list[Path]:
    found: list[Path] = []
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        if path.name in SKIP_NAMES:
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.suffix.lower() in suffixes or path.name in EXTRA_NAMES:
            found.append(path)
    return sorted(found)
