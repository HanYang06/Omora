"""架构测试：内核与 SDK 不得出现领域词汇。"""

import re
from pathlib import Path

FORBIDDEN = re.compile(r"\b(Idea|Project|Requirement|Kanban|GitHub|GitLab)s?\b", re.IGNORECASE)
ROOT = Path(__file__).resolve().parents[3]
TARGETS = [ROOT / "kernel" / "src" / "omora_kernel", ROOT / "sdk" / "src" / "omora_sdk"]


def test_core_has_no_domain_vocabulary() -> None:
    violations: list[str] = []
    for base in TARGETS:
        for path in base.rglob("*.py"):
            for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                if FORBIDDEN.search(line):
                    violations.append(f"{path.relative_to(ROOT)}:{lineno}: {line.strip()}")
    assert violations == [], "内核出现领域词汇：\n" + "\n".join(violations)
