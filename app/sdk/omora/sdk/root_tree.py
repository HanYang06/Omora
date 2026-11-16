"""窗口根骨架加载器（S7.2）：`root-tree.json` 是窗口骨架的唯一来源。

根树结构文件定义窗口根、导航栏与页面区三个 Slot 的 id / kind / 布局，以及
`anchors` 语义锚点（window / nav / page → Slot id）。Python 与 TS 两侧都从这里
加载，不再各自维护一份字面量；加载即校验，文件坏了在导入期就报错：

- schema / version 必须是当前契约版本；
- 根节点必须能当 Slot 校验（id / kind / owner / 布局），整棵树 id 唯一；
- 根 kind 必须是 `dendro:window`；
- anchors 必须存在、指向树里真实存在的 id，window 锚点必须就是根 id。

默认根树在模块导入时加载一次；测试与工具可以用 `load_root_tree(path)` 换一份
文件。本模块只读文件，不写文件。
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any

from .document import (
    SCHEMA,
    DocumentError,
    Layout,
    Slot,
    _non_empty,
    _require,
)
from .document_io import _validate_slot
from .identity import chain_addr

VERSION = 1
ROOT_KIND = "dendro:window"
WINDOW_ANCHOR = "window"
NAV_ANCHOR = "nav"
PAGE_ANCHOR = "page"
REQUIRED_ANCHORS = (WINDOW_ANCHOR, NAV_ANCHOR, PAGE_ANCHOR)
DEFAULT_PATH = Path(__file__).with_name("root-tree.json")


@dataclass(frozen=True)
class RootTree:
    """一份校验过的根树结构：根 Slot + 语义锚点。

    `root` 已经过契约层 Slot 校验（id 唯一、kind 命名空间、owner、布局），
    `anchors` 是只读的 锚点名 → Slot id；两者都只当常量读。
    """

    schema: str
    version: int
    root: Slot
    anchors: Mapping[str, str]

    def anchor(self, name: str) -> str:
        """锚点名 → Slot id；没有这个锚点就抛 DocumentError。"""
        target = self.anchors.get(name)
        if target is None:
            raise DocumentError(f"根树没有锚点: {name!r}")
        return target

    def ids(self) -> tuple[str, ...]:
        """根树里所有 Slot id，按文档顺序。"""
        found: list[str] = []
        _collect_ids(self.root, found)
        return tuple(found)


def _collect_ids(slot: Slot, found: list[str]) -> None:
    found.append(slot.id)
    for child in slot.children:
        _collect_ids(child, found)


def _mapping(value: object, where: str) -> Mapping[str, Any]:
    """断言是对象并返回（`_require` 不是 TypeGuard，mypy 需要显式窄化）。"""
    if not isinstance(value, Mapping):
        raise DocumentError(f"{where} 必须是对象")
    return value


def _list(value: object, where: str) -> list[Any]:
    if not isinstance(value, list):
        raise DocumentError(f"{where} 必须是数组")
    return value


def _layout_from_json(value: object, where: str) -> Layout:
    record = _mapping(value, f"{where}.layout")
    size = record.get("size")
    if size is not None:
        size_record = _mapping(size, f"{where}.layout.size")
        for key, raw in size_record.items():
            _require(
                isinstance(raw, (str, int, float)) and not isinstance(raw, bool),
                f"{where}.layout.size.{key} 必须是字符串或数字",
            )
    return Layout(
        flow=record.get("flow", "column"),
        size=size,
        gap=record.get("gap"),
        align=record.get("align"),
        scroll=record.get("scroll"),
        capacity=record.get("capacity", "many"),
    )


def _slot_from_json(value: object, where: str) -> Slot:
    """JSON 节点 → Slot；形状错误抛 DocumentError（id 唯一性交给 serialize_slot）。"""
    record = _mapping(value, where)
    slot_id = _non_empty(record.get("id"), f"{where}.id")
    kind = _non_empty(record.get("kind"), f"{slot_id}.kind")
    owner = _non_empty(record.get("owner"), f"{slot_id}.owner")
    props = _mapping(record.get("props"), f"{slot_id}.props")
    children = _list(record.get("children"), f"{slot_id}.children")
    layout_raw = record.get("layout")
    code = record.get("code")
    addr = record.get("addr")
    return Slot(
        slot_id,
        kind,
        owner=owner,
        props=props,
        children=tuple(
            _slot_from_json(child, f"{slot_id}.children[{index}]")
            for index, child in enumerate(children)
        ),
        layout=None if layout_raw is None else _layout_from_json(layout_raw, slot_id),
        code=None if code is None else _non_empty(code, f"{slot_id}.code"),
        addr=None if addr is None else _non_empty(addr, f"{slot_id}.addr"),
    )


def _parse_anchors(
    value: object, ids: frozenset[str], root_id: str, where: str
) -> Mapping[str, str]:
    record = _mapping(value, where)
    anchors: dict[str, str] = {}
    for name, target in record.items():
        anchor_name = _non_empty(name, f"{where} 的键")
        anchor_id = _non_empty(target, f"{where}.{anchor_name}")
        _require(anchor_id in ids, f"{where}.{anchor_name} 指向不存在的 id: {anchor_id}")
        anchors[anchor_name] = anchor_id
    for name in REQUIRED_ANCHORS:
        _require(name in anchors, f"{where} 缺少锚点: {name}")
    _require(
        anchors[WINDOW_ANCHOR] == root_id,
        f"{where}.{WINDOW_ANCHOR} 必须是根 id: {root_id}",
    )
    return MappingProxyType(anchors)


def _validate_identity(slot: Slot, parent_addr: str | None, where: str) -> None:
    """静态 code/addr 必须成对，且 addr 能由父 addr + 本地 code 重新算出来。"""
    _require(
        (slot.code is None) == (slot.addr is None),
        f"{where} 的 code/addr 必须成对出现",
    )
    if slot.code is not None and slot.addr is not None:
        expected = chain_addr(parent_addr, slot.code)
        _require(
            slot.addr == expected,
            f"{where}.addr 与 code / 父 addr 不一致: 期望 {expected}，实际 {slot.addr}",
        )
    child_parent = slot.addr if slot.addr is not None else parent_addr
    for index, child in enumerate(slot.children):
        _validate_identity(child, child_parent, f"{where}.children[{index}]")


def parse_root_tree(value: object, *, source: str = "$") -> RootTree:
    """校验一份根树结构（已解析的 JSON 值），返回只读视图。"""
    record = _mapping(value, source)
    _require(
        record.get("schema") == SCHEMA,
        f"{source}.schema 必须是 {SCHEMA}，实际是 {record.get('schema')!r}",
    )
    version = record.get("version")
    _require(
        isinstance(version, int) and not isinstance(version, bool) and version == VERSION,
        f"{source}.version 必须是 {VERSION}，实际是 {version!r}",
    )
    root = _slot_from_json(record.get("root"), f"{source}.root")
    _require(
        root.kind == ROOT_KIND,
        f"{source}.root.kind 必须是 {ROOT_KIND}，实际是 {root.kind!r}",
    )
    _validate_slot(root, set())
    _validate_identity(root, None, f"{source}.root")
    found: list[str] = []
    _collect_ids(root, found)
    anchors = _parse_anchors(record.get("anchors"), frozenset(found), root.id, f"{source}.anchors")
    return RootTree(schema=SCHEMA, version=VERSION, root=root, anchors=anchors)


def load_root_tree(path: str | Path | None = None) -> RootTree:
    """从文件加载并校验根树；默认读包内 `root-tree.json`。

    文件读不到、不是合法 JSON、或形状不合法都抛 DocumentError。
    """
    source = DEFAULT_PATH if path is None else Path(path)
    try:
        text = source.read_text(encoding="utf-8")
    except OSError as error:
        raise DocumentError(f"读不到根树结构文件: {source}") from error
    try:
        raw: object = json.loads(text)
    except json.JSONDecodeError as error:
        raise DocumentError(f"根树结构文件不是合法 JSON: {source}") from error
    return parse_root_tree(raw, source=str(source))


ROOT_TREE: RootTree = load_root_tree()
"""默认根树：包内 `root-tree.json` 的校验结果。"""

ROOT_ID: str = ROOT_TREE.root.id
"""窗口根的 id。"""

ANCHORS: Mapping[str, str] = ROOT_TREE.anchors
"""语义锚点：window / nav / page → Slot id（只读）。"""


def anchor(name: str) -> str:
    """默认根树的语义锚点 → Slot id。"""
    return ROOT_TREE.anchor(name)


def ids() -> tuple[str, ...]:
    """默认根树里所有 Slot id（文档顺序）。"""
    return ROOT_TREE.ids()


NAV_MOUNT_AT: str = anchor(NAV_ANCHOR)
"""导航局部树的挂载目标。"""

PAGE_MOUNT_AT: str = anchor(PAGE_ANCHOR)
"""页面局部树的挂载目标。"""

__all__ = [
    "ANCHORS",
    "DEFAULT_PATH",
    "NAV_ANCHOR",
    "NAV_MOUNT_AT",
    "PAGE_ANCHOR",
    "PAGE_MOUNT_AT",
    "REQUIRED_ANCHORS",
    "ROOT_ID",
    "ROOT_KIND",
    "ROOT_TREE",
    "VERSION",
    "WINDOW_ANCHOR",
    "RootTree",
    "anchor",
    "ids",
    "load_root_tree",
    "parse_root_tree",
]
