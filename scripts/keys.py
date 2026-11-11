"""界面键索引：把插件声明与使用的全限定键扫成一份清单。

扫的是源码里的字面量（`Slot(key=...)` 声明、`contribute(..., target)` 使用），
不跑插件：构建期只需要知道"有哪些键、谁声明、谁在用"。

产物三份，都是生成的：

- `app/sdk/omora/sdk/keys.py`  Python 常量，写代码不用手打字符串
- `app/ui-engine/src/generated/keys.ts`  TS 同名常量
- `keys.json`  索引：声明者、file:line、使用者

用法：

    uv run python scripts/keys.py            # 重写产物
    uv run python scripts/keys.py --check    # 只校验产物是否最新（CI）
"""

from __future__ import annotations

import argparse
import ast
import json
import re
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKAGES = ROOT / "app" / "packages"
PYTHON_OUT = ROOT / "app" / "sdk" / "omora" / "sdk" / "keys.py"
TS_OUT = ROOT / "app" / "ui-engine" / "src" / "generated" / "keys.ts"
INDEX_OUT = ROOT / "keys.json"

KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$")
"""全限定键：至少两段，每段小写字母开头、只含小写字母数字下划线。"""

BUILTIN = {"om.window.page": "ui"}
"""窗口区域键：引擎和页面自己用的，不在插件源码里声明。"""

PYTHON_HEADER = '"""生成物：界面键清单。别手改，改完源码跑 `uv run python scripts/keys.py`。"""'
TS_HEADER = "/** 生成物：界面键清单。别手改，改完源码跑 `uv run python scripts/keys.py`。 */"


class KeysError(Exception):
    """键清单有问题：格式不对、重复声明、常量撞名。"""


@dataclass(frozen=True)
class Hit:
    """一次出现：哪个插件的哪一行。"""

    owner: str
    path: str
    line: int


@dataclass(frozen=True)
class Entry:
    """一把键：谁声明、谁在用。"""

    key: str
    declared_by: str
    declarations: tuple[Hit, ...]
    uses: tuple[Hit, ...]


def _relative(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def owner_of(path: Path, root: Path) -> str:
    """app/packages/<owner>/... → <owner>；别的地方给 -。"""
    parts = _relative(path, root).split("/")
    if len(parts) >= 3 and parts[0] == "app" and parts[1] == "packages":
        return parts[2]
    return "-"


def _literal(node: ast.expr | None) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def _calls(tree: ast.AST) -> tuple[list[tuple[str, ast.Call]], list[tuple[str, ast.Call]]]:
    declares: list[tuple[str, ast.Call]] = []
    uses: list[tuple[str, ast.Call]] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        name = node.func.id if isinstance(node.func, ast.Name) else None
        attr = node.func.attr if isinstance(node.func, ast.Attribute) else None
        if name == "Slot":
            key = _keyword(node, "key")
            if key is not None:
                declares.append((key, node))
        elif attr == "contribute":
            key = _keyword(node, "target")
            if key is None and len(node.args) >= 2:
                key = _literal(node.args[1])
            if key is not None:
                uses.append((key, node))
    return declares, uses


def _keyword(call: ast.Call, name: str) -> str | None:
    for keyword in call.keywords:
        if keyword.arg == name:
            return _literal(keyword.value)
    return None


def scan(root: Path = ROOT) -> dict[str, Entry]:
    """扫 app/packages 下的插件源码，返回按键排好的清单。"""
    declarations: dict[str, list[Hit]] = {}
    uses: dict[str, list[Hit]] = {}
    for path in sorted((root / "app" / "packages").rglob("*.py")):
        if "tests" in path.parts:
            continue
        source = path.read_text(encoding="utf-8")
        try:
            tree = ast.parse(source, filename=str(path))
        except SyntaxError as exc:
            raise KeysError(f"{_relative(path, root)} 解析失败: {exc.msg}") from exc
        hit_owner = owner_of(path, root)
        hit_path = _relative(path, root)
        for key, node in _calls(tree)[0]:
            _validate(key, hit_path, node.lineno)
            declarations.setdefault(key, []).append(Hit(hit_owner, hit_path, node.lineno))
        for key, node in _calls(tree)[1]:
            _validate(key, hit_path, node.lineno)
            uses.setdefault(key, []).append(Hit(hit_owner, hit_path, node.lineno))

    for key, hits in declarations.items():
        if len(hits) > 1:
            where = ", ".join(f"{hit.path}:{hit.line}" for hit in hits)
            raise KeysError(f"键重复声明: {key}（{where}）")

    constants: dict[str, str] = {}
    entries: dict[str, Entry] = {}
    for key in sorted(set(declarations) | set(uses) | set(BUILTIN)):
        constant = constant_of(key)
        if constant in constants:
            raise KeysError(f"常量撞名: {key} 与 {constants[constant]} 都叫 {constant}")
        constants[constant] = key
        declared = tuple(declarations.get(key, ()))
        declared_by = declared[0].owner if declared else BUILTIN.get(key, "-")
        entries[key] = Entry(
            key=key,
            declared_by=declared_by,
            declarations=declared,
            uses=tuple(uses.get(key, ())),
        )
    return entries


def _validate(key: str, path: str, line: int) -> None:
    if KEY_PATTERN.match(key) is None:
        raise KeysError(f"{path}:{line} 的键不合格: {key!r}（至少两段，每段小写）")


def constant_of(key: str) -> str:
    return key.replace(".", "_").upper()


def _python(entries: dict[str, Entry]) -> str:
    lines = [
        PYTHON_HEADER,
        "",
        "from __future__ import annotations",
        "",
        "KEYS: frozenset[str] = frozenset(",
    ]
    lines.append("    {")
    lines.extend(f'        "{entry.key}",' for entry in entries.values())
    lines.append("    }")
    lines.append(")")
    lines.append("")
    lines.extend(f'{constant_of(entry.key)}: str = "{entry.key}"' for entry in entries.values())
    lines.append("")
    return "\n".join(lines)


def _ts(entries: dict[str, Entry]) -> str:
    lines = [TS_HEADER, "", "export const KEYS = ["]
    lines.extend(f'  "{entry.key}",' for entry in entries.values())
    lines.append("] as const;")
    lines.append("")
    lines.extend(
        f'export const {constant_of(entry.key)} = "{entry.key}";' for entry in entries.values()
    )
    lines.append("")
    return "\n".join(lines)


def _index(entries: dict[str, Entry]) -> str:
    payload = {
        "keys": [
            {
                "key": entry.key,
                "declared_by": entry.declared_by,
                "declarations": [hit.__dict__ for hit in entry.declarations],
                "uses": [hit.__dict__ for hit in entry.uses],
            }
            for entry in entries.values()
        ]
    }
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def render(entries: dict[str, Entry]) -> dict[Path, str]:
    """产物路径 → 内容。"""
    return {
        PYTHON_OUT: _python(entries),
        TS_OUT: _ts(entries),
        INDEX_OUT: _index(entries),
    }


def _check(entries: dict[str, Entry]) -> list[str]:
    problems: list[str] = []
    for path, expected in render(entries).items():
        actual = path.read_text(encoding="utf-8") if path.exists() else None
        if actual != expected:
            problems.append(f"{path.relative_to(ROOT).as_posix()} 不是最新的")
    return problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="界面键索引：生成 Python / TS 常量与 keys.json")
    parser.add_argument("--check", action="store_true", help="只校验产物是否最新，不写")
    args = parser.parse_args(argv)
    try:
        entries = scan()
    except KeysError as exc:
        print(f"键清单错误: {exc}")
        return 1

    if args.check:
        problems = _check(entries)
        if problems:
            print("FAIL keys")
            for problem in problems:
                print(f"  {problem}")
            print("  跑 uv run python scripts/keys.py 重新生成")
            return 1
        print("PASS keys")
        return 0

    for path, content in render(entries).items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    print(f"WROTE {len(entries)} keys")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
