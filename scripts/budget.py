"""体量预算：读取 budget.json，检查文件行数、函数体量、类方法数与复杂度。"""

from __future__ import annotations

import ast
import json
from pathlib import Path
from typing import cast

from common import ROOT, TEXT_SUFFIXES, Problem, iter_files, read_text

BUDGET_PATH = ROOT / "budget.json"
REQUIRED_KEYS = ("fileLines", "functionLines", "classMethods", "params", "complexity", "imports")
PY_ROOTS = ("kernel/", "sdk/", "plugins/", "scripts/")
PY_SUFFIXES = {".py"}

LimitMap = dict[str, int]

COMPLEXITY_NODES = (
    ast.If,
    ast.IfExp,
    ast.For,
    ast.AsyncFor,
    ast.While,
    ast.ExceptHandler,
    ast.Assert,
    ast.ListComp,
    ast.SetComp,
    ast.DictComp,
    ast.GeneratorExp,
)


def _parse_limits(raw: object, where: str) -> LimitMap:
    if not isinstance(raw, dict):
        raise SystemExit(f"budget.json 的 {where} 必须是对象")
    parsed: LimitMap = {}
    entries = cast(dict[object, object], raw)
    for key, value in entries.items():
        if not isinstance(key, str) or not isinstance(value, int):
            raise SystemExit(f"budget.json 的 {where} 含非法条目: {key!r}")
        parsed[key] = value
    return parsed


def _as_mapping(raw: object) -> dict[str, object]:
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise SystemExit("budget.json 期望对象")
    entries = cast(dict[object, object], raw)
    return {str(key): value for key, value in entries.items()}


class Budget:
    def __init__(self) -> None:
        payload: object = json.loads(read_text(BUDGET_PATH))
        if not isinstance(payload, dict):
            raise SystemExit("budget.json 顶层必须是对象")
        data = cast(dict[str, object], payload)
        defaults = _parse_limits(data.get("defaults"), "defaults")
        missing = [key for key in REQUIRED_KEYS if key not in defaults]
        if missing:
            raise SystemExit(f"budget.json 缺少默认项: {', '.join(missing)}")
        self.defaults: LimitMap = defaults
        self.suffixes: dict[str, LimitMap] = {
            str(key).lower(): _parse_limits(value, f"suffixes.{key}")
            for key, value in _as_mapping(data.get("suffixes")).items()
        }
        self.paths: dict[str, LimitMap] = {
            str(key).strip("/"): _parse_limits(value, f"paths.{key}")
            for key, value in _as_mapping(data.get("paths")).items()
        }

    def limits_for(self, path: Path) -> LimitMap:
        merged: LimitMap = dict(self.defaults)
        merged.update(self.suffixes.get(path.suffix.lower(), {}))
        rel = path.relative_to(ROOT).as_posix()
        for prefix, override in self.paths.items():
            if rel.startswith(prefix + "/"):
                merged.update(override)
        return merged


def check_file_budget(budget: Budget) -> list[Problem]:
    problems: list[Problem] = []
    for path in iter_files(TEXT_SUFFIXES):
        limits = budget.limits_for(path)
        limit = limits.get("fileLines")
        if limit is None:
            continue
        lines = len(read_text(path).splitlines())
        if lines > limit:
            problems.append(Problem(path, f"{lines} 行，超过预算 {limit}"))
    return problems


def _param_count(node: ast.FunctionDef | ast.AsyncFunctionDef) -> int:
    args = node.args
    count = len(args.posonlyargs) + len(args.args) + len(args.kwonlyargs)
    if args.vararg is not None:
        count += 1
    if args.kwarg is not None:
        count += 1
    positional = [*args.posonlyargs, *args.args]
    if positional and positional[0].arg in {"self", "cls"}:
        count -= 1
    return max(count, 0)


def _complexity(node: ast.AST) -> int:
    score = 1
    for child in ast.walk(node):
        if isinstance(child, COMPLEXITY_NODES):
            score += 1
        elif isinstance(child, ast.BoolOp):
            score += len(child.values) - 1
    return score


def _check_function(
    path: Path,
    node: ast.FunctionDef | ast.AsyncFunctionDef,
    limits: LimitMap,
    problems: list[Problem],
) -> None:
    if node.end_lineno is None:
        return
    length = node.end_lineno - node.lineno + 1
    if length > limits["functionLines"]:
        problems.append(
            Problem(
                path,
                f"函数 {node.name} 有 {length} 行，超过预算 {limits['functionLines']}",
                node.lineno,
            )
        )
    params = _param_count(node)
    if params > limits["params"]:
        problems.append(
            Problem(
                path,
                f"函数 {node.name} 有 {params} 个参数，超过预算 {limits['params']}",
                node.lineno,
            )
        )
    score = _complexity(node)
    if score > limits["complexity"]:
        problems.append(
            Problem(
                path,
                f"函数 {node.name} 复杂度 {score}，超过预算 {limits['complexity']}",
                node.lineno,
            )
        )


def check_python_structure(budget: Budget) -> list[Problem]:
    problems: list[Problem] = []
    for path in iter_files(PY_SUFFIXES):
        rel = path.relative_to(ROOT).as_posix()
        if not rel.startswith(PY_ROOTS):
            continue
        limits = budget.limits_for(path)
        tree = ast.parse(read_text(path), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                _check_function(path, node, limits, problems)
            elif isinstance(node, ast.ClassDef):
                methods = sum(
                    isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef))
                    for child in node.body
                )
                if methods > limits["classMethods"]:
                    message = (
                        f"类 {node.name} 有 {methods} 个方法，超过预算 {limits['classMethods']}"
                    )
                    problems.append(Problem(path, message, node.lineno))
        imports = sum(isinstance(node, (ast.Import, ast.ImportFrom)) for node in tree.body)
        if imports > limits["imports"]:
            problems.append(Problem(path, f"{imports} 个 import，超过预算 {limits['imports']}"))
    return problems
