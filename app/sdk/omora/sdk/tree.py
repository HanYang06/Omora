"""UI 树格式 V1（dendro.tree/1）：形状交给 JSON Schema，结构不变量由 Python 守。

唯一格式源是 `schema/tree/tree.schema.json`；生成类型与常量在 `tree_generated.py`。
本模块只做三件事：

1. 校验形状：用 Draft 2020-12 校验 document / partial / node 三份子 schema
   （取自 `$defs`），不拿整份 `oneOf` 去套，错误路径才能具体到字段。
2. 映射稳定码：形状错误按 id / chain / mount.mode / root.kind / 其余分类，
   按 JSON 路径排序取第一条。
3. 校验语义：chain 必须由父 chain + "." + id 推出；id / chain 全局唯一；
   同级 order 唯一且 layout 升序；非 layout 字段不得藏节点；pages / active /
   ledger 必须落在树里。

Python 是语义权威；partial 的挂载点是 `Mount(parent, mode)`。
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from functools import cache
from pathlib import Path
from typing import Any, NoReturn, cast

from jsonschema import Draft202012Validator  # type: ignore[import-untyped]
from jsonschema.exceptions import ValidationError  # type: ignore[import-untyped]

from .tree_generated import (
    CHAIN_FIELD,
    CHAIN_PATTERN,
    ID_FIELD,
    ID_PATTERN,
    LAYOUT_FIELD,
    NON_NESTING_FIELDS,
    ORDER_FIELD,
    SCHEMA,
    Document,
    LedgerEntry,
    Mount,
    Node,
    Page,
    Partial,
    Placement,
)


class TreeError(ValueError):
    """树格式不合法：带稳定诊断码与路径。"""

    def __init__(self, code: str, path: str, message: str) -> None:
        self.code = code
        self.path = path
        self.message = message
        super().__init__(f"{code} @ {path}: {message}")


def _fail(code: str, path: str, message: str) -> NoReturn:
    raise TreeError(code, path, message)


_SCHEMA_FILE = ("schema", "tree", "tree.schema.json")
_NODE_SHAPE = frozenset({ID_FIELD, CHAIN_FIELD, "kind", LAYOUT_FIELD})


@cache
def _schema() -> dict[str, Any]:
    """读一次唯一格式源；按仓库布局向上找，找到即缓存。"""
    for root in Path(__file__).resolve().parents:
        candidate = root.joinpath(*_SCHEMA_FILE)
        if candidate.is_file():
            return cast(dict[str, Any], json.loads(candidate.read_text(encoding="utf-8")))
    raise RuntimeError("找不到唯一格式源 " + "/".join(_SCHEMA_FILE))


@cache
def _validator(kind: str) -> Draft202012Validator:
    """只看一种形状：顶层 $ref 指向一份 $defs，避免整份 oneOf 的笼统错误。"""
    return Draft202012Validator({"$ref": f"#/$defs/{kind}", "$defs": _schema()["$defs"]})


def _render(path: tuple[str | int, ...], *, pad: bool = False) -> str:
    text = "$"
    for part in path:
        if isinstance(part, int):
            text += f"[{part:010d}]" if pad else f"[{part}]"
        else:
            text += f".{part}"
    return text


def _shape_code(path: tuple[str | int, ...], error: ValidationError) -> str:
    if error.validator == "pattern":
        if error.validator_value == ID_PATTERN:
            return "E-TREE-ID"
        if error.validator_value == CHAIN_PATTERN:
            return "E-TREE-CHAIN"
    elif error.validator == "enum" and path[-2:] == ("mount", "mode"):
        return "E-TREE-MOUNT"
    elif error.validator == "const" and path[-2:] == ("root", "kind"):
        return "E-TREE-ROOT"
    return "E-TREE-PAYLOAD"


def _shape(value: object, kind: str, path: str) -> dict[str, Any]:
    """校验一种形状；失败时按路径稳定排序取第一条，映射成稳定码。"""
    errors: list[ValidationError] = list(_validator(kind).iter_errors(value))
    if errors:
        first = min(errors, key=lambda error: _render(tuple(error.absolute_path), pad=True))
        at = tuple(first.absolute_path)
        rendered = _render(at)
        if path != "$":
            rendered = path + rendered[1:]
        _fail(_shape_code(at, first), rendered, first.message)
    return cast(dict[str, Any], value)


class _Seen:
    """一次校验里已见过的身份与地址，用来查重。"""

    def __init__(self) -> None:
        self.ids: set[str] = set()
        self.chains: set[str] = set()


def _reject_nested(value: object, path: str) -> None:
    """非 layout 字段里递归不允许出现节点形状；挡住第二套嵌套。"""
    if isinstance(value, dict):
        if value.keys() >= _NODE_SHAPE:
            _fail("E-TREE-NEST", path, "非 layout 字段里出现了节点形状")
        for key, item in value.items():
            _reject_nested(item, f"{path}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _reject_nested(item, f"{path}[{index}]")


def _placement(value: object) -> Placement:
    slot = cast(dict[str, Any], value)
    raw_size = slot.get("size")
    size: Mapping[str, str | int | float] = (
        cast(Mapping[str, str | int | float], raw_size) if raw_size is not None else {}
    )
    return Placement(size=size, align=slot.get("align"), span=slot.get("span"))


def _walk_node(
    value: object,
    path: str,
    parent_chain: str | None,
    *,
    root_chain: bool,
    seen: _Seen,
) -> Node:
    """形状已由 schema 保证，这里只查结构不变量并构造 Node。"""
    record = cast(dict[str, Any], value)
    node_id: str = record[ID_FIELD]
    chain: str = record[CHAIN_FIELD]
    if chain.rsplit(".", 1)[-1] != node_id:
        _fail("E-TREE-CHAIN", f"{path}.{CHAIN_FIELD}", "chain 最后一段必须等于 id")
    if parent_chain is None:
        if root_chain and chain != node_id:
            _fail("E-TREE-CHAIN", f"{path}.{CHAIN_FIELD}", "根节点的 chain 必须等于 id")
    elif chain != f"{parent_chain}.{node_id}":
        _fail("E-TREE-CHAIN", f"{path}.{CHAIN_FIELD}", "child chain 必须是父 chain + '.' + id")
    if node_id in seen.ids:
        _fail("E-TREE-DUP-ID", f"{path}.{ID_FIELD}", f"重复 id: {node_id}")
    if chain in seen.chains:
        _fail("E-TREE-DUP-CHAIN", f"{path}.{CHAIN_FIELD}", f"重复 chain: {chain}")
    seen.ids.add(node_id)
    seen.chains.add(chain)

    layout = tuple(
        _walk_node(
            item,
            f"{path}.{LAYOUT_FIELD}[{index}]",
            chain,
            root_chain=False,
            seen=seen,
        )
        for index, item in enumerate(record[LAYOUT_FIELD])
    )
    orders = [child.order for child in layout]
    if len(set(orders)) != len(orders):
        _fail("E-TREE-ORDER", f"{path}.{LAYOUT_FIELD}", "同级 order 必须唯一")
    if orders != sorted(orders):
        _fail("E-TREE-ORDER", f"{path}.{LAYOUT_FIELD}", "layout 必须按 order 升序")

    for name in NON_NESTING_FIELDS:
        _reject_nested(record[name], f"{path}.{name}")

    return Node(
        id=node_id,
        chain=chain,
        kind=record["kind"],
        order=record[ORDER_FIELD],
        layout=layout,
        settings=cast(Mapping[str, Any], record["settings"]),
        bind=cast(Mapping[str, Any], record["bind"]),
        on=cast(Mapping[str, Any], record["on"]),
        emit=cast(Mapping[str, Any], record["emit"]),
        title=record.get("title"),
        slot=_placement(record["slot"]) if "slot" in record else None,
    )


def _pages(value: object, path: str, ids: set[str]) -> tuple[Page, ...]:
    pages: list[Page] = []
    seen: set[str] = set()
    for index, item in enumerate(cast(list[Any], value)):
        page_path = f"{path}[{index}]"
        page = cast(dict[str, Any], item)
        page_id: str = page[ID_FIELD]
        if page_id in seen:
            _fail("E-TREE-PAGE", f"{page_path}.{ID_FIELD}", f"重复页面 id: {page_id}")
        if page_id not in ids:
            _fail("E-TREE-PAGE", f"{page_path}.{ID_FIELD}", "页面 id 不在树里")
        seen.add(page_id)
        pages.append(Page(id=page_id, title=page["title"], route=page["route"]))
    return tuple(pages)


def _ledger(value: object, path: str, ids: set[str]) -> dict[str, LedgerEntry]:
    entries = cast(dict[str, Any], value)
    out: dict[str, LedgerEntry] = {}
    for key, item in entries.items():
        if key not in ids:
            _fail("E-TREE-LEDGER", f"{path}.{key}", "ledger 键必须是节点 id")
        entry = cast(dict[str, Any], item)
        fields = cast(Mapping[str, str], entry.get("fields") or {})
        out[key] = LedgerEntry(source=entry["source"], fields=fields)
    return out


def parse_node(value: object, path: str = "$", *, root_chain: bool = False) -> Node:
    """校验一个节点/子树；root_chain=True 时 chain 必须等于 id。"""
    return _walk_node(
        _shape(value, "node", path),
        path,
        None,
        root_chain=root_chain,
        seen=_Seen(),
    )


def parse_document(value: object, path: str = "$") -> Document:
    """校验一份根树文档：root 节点 + 页面侧表 + 数据 + provenance。"""
    record = _shape(value, "document", path)
    seen = _Seen()
    root = _walk_node(record["root"], f"{path}.root", None, root_chain=True, seen=seen)
    pages = _pages(record["pages"], f"{path}.pages", seen.ids)
    active: str = record["active"]
    if pages:
        if active not in {page.id for page in pages}:
            _fail("E-TREE-PAGE", f"{path}.active", "active 必须指向一个页面")
    elif active != "":
        _fail("E-TREE-PAGE", f"{path}.active", "没有页面时 active 必须是空串")
    return Document(
        schema=record["schema"],
        version=record["version"],
        root=root,
        pages=pages,
        active=active,
        data=cast(Mapping[str, Any], record["data"]),
        ledger=_ledger(record.get("ledger", {}), f"{path}.ledger", seen.ids),
    )


def parse_partial(value: object, path: str = "$") -> Partial:
    """校验一个局部树：来源 + 挂载点（稳定 id）+ root 子树。"""
    record = _shape(value, "partial", path)
    mount = cast(dict[str, Any], record["mount"])
    return Partial(
        schema=record["schema"],
        source=record["source"],
        mount=Mount(parent=mount["parent"], mode=mount["mode"]),
        root=_walk_node(
            record["root"],
            f"{path}.root",
            None,
            root_chain=False,
            seen=_Seen(),
        ),
    )


def _load_json(path: str | Path) -> object:
    source = Path(path)
    try:
        return json.loads(source.read_text(encoding="utf-8"))
    except OSError as error:
        raise TreeError("E-TREE-IO", str(source), f"读不到: {error}") from error
    except json.JSONDecodeError as error:
        raise TreeError("E-TREE-IO", str(source), f"不是合法 JSON: {error}") from error


def load_node(path: str | Path) -> Node:
    return parse_node(_load_json(path))


def load_document(path: str | Path) -> Document:
    return parse_document(_load_json(path))


def load_partial(path: str | Path) -> Partial:
    return parse_partial(_load_json(path))


__all__ = [
    "SCHEMA",
    "Document",
    "LedgerEntry",
    "Mount",
    "Node",
    "Page",
    "Partial",
    "Placement",
    "TreeError",
    "load_document",
    "load_node",
    "load_partial",
    "parse_document",
    "parse_node",
    "parse_partial",
]
