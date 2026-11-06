"""测试质量：拒绝只用类型 / 非空断言凑数的测试。"""

from __future__ import annotations

import ast
from pathlib import Path

from common import ROOT, Problem, read_text

TEST_ROOTS = ("kernel/tests", "plugins", "web/tests")


def iter_test_files() -> list[Path]:
    files: list[Path] = []
    for rel in TEST_ROOTS:
        base = ROOT / rel
        if not base.exists():
            continue
        for path in base.rglob("*.py"):
            if path.is_file():
                files.append(path)
    return sorted(files)


def _is_weak(node: ast.expr) -> bool:
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
        return node.func.id == "isinstance"
    if isinstance(node, ast.Compare) and any(
        isinstance(op, (ast.Is, ast.IsNot)) for op in node.ops
    ):
        return all(
            isinstance(item, ast.Constant) and item.value is None for item in node.comparators
        )
    return False


def _is_sleep(node: ast.AST) -> bool:
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "sleep"
    )


def _check_test_function(path: Path, node: ast.FunctionDef | ast.AsyncFunctionDef) -> list[Problem]:
    problems: list[Problem] = []
    asserts = [child for child in ast.walk(node) if isinstance(child, ast.Assert)]
    if asserts and all(_is_weak(assertion.test) for assertion in asserts):
        problems.append(Problem(path, f"{node.name} 只断言类型或非空，没有验证行为", node.lineno))
    for child in ast.walk(node):
        if _is_sleep(child):
            problems.append(Problem(path, f"{node.name} 使用了 sleep", node.lineno))
    return problems


def check_test_quality() -> list[Problem]:
    problems: list[Problem] = []
    for path in iter_test_files():
        tree = ast.parse(read_text(path), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith(
                "test_"
            ):
                problems.extend(_check_test_function(path, node))
    return problems
