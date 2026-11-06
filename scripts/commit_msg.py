"""校验提交信息格式。由 .githooks/commit-msg 调用。"""

from __future__ import annotations

import re
import sys
from pathlib import Path

TYPES = {
    "feat",
    "fix",
    "refactor",
    "perf",
    "test",
    "docs",
    "build",
    "ci",
    "chore",
    "contract",
    "revert",
}
GENERIC = {"update", "fix", "wip", "temp", "changes", "stuff", "commit"}
MAX_HEADER = 72
MAX_SUBJECT = 50
MIN_SUBJECT = 4
MAX_LINE = 72
HEADER_RE = re.compile(r"^(?P<type>[a-z]+)(?:\((?P<scope>[a-z0-9][a-z0-9-]*)\))?: (?P<subject>.+)$")


def _lines(text: str) -> list[str]:
    cleaned = [line.rstrip() for line in text.splitlines() if not line.startswith("#")]
    while cleaned and cleaned[-1] == "":
        cleaned.pop()
    return cleaned


def _subject_errors(subject: str) -> list[str]:
    errors: list[str] = []
    if not MIN_SUBJECT <= len(subject) <= MAX_SUBJECT:
        errors.append(f"subject 长度应为 {MIN_SUBJECT}–{MAX_SUBJECT}，当前 {len(subject)}")
    if subject.endswith((".", "。")):
        errors.append("subject 不要以句号结尾")
    if subject.lower() in GENERIC:
        errors.append(f"subject 太笼统：{subject!r}")
    return errors


def validate(text: str) -> list[str]:
    lines = _lines(text)
    if not lines:
        return ["提交信息为空"]
    header = lines[0]
    if len(header) > MAX_HEADER:
        return [f"标题超过 {MAX_HEADER} 字符（当前 {len(header)}）"]
    if header.startswith(("Merge ", "Revert ")):
        return []
    match = HEADER_RE.match(header)
    if match is None:
        return ["标题格式必须是 type(scope): subject"]
    errors: list[str] = []
    commit_type = match.group("type")
    if commit_type not in TYPES:
        errors.append(f"未知类型 {commit_type!r}；可用：{', '.join(sorted(TYPES))}")
    errors.extend(_subject_errors(match.group("subject").strip()))
    if len(lines) > 1:
        if lines[1] != "":
            errors.append("标题与正文之间必须空一行")
        for number, line in enumerate(lines[2:], 3):
            if len(line) > MAX_LINE and "://" not in line:
                errors.append(f"第 {number} 行超过 {MAX_LINE} 字符")
    return errors


def main() -> int:
    if len(sys.argv) != 2:
        print("用法: commit_msg.py <message-file>", file=sys.stderr)
        return 2
    text = Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace")
    errors = validate(text)
    if not errors:
        return 0
    print("提交信息不符合规范：", file=sys.stderr)
    for error in errors:
        print("  - " + error, file=sys.stderr)
    print("规范见 .agents/skills/omora-git/SKILL.md", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
