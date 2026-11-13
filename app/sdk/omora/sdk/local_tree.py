"""Dendrolink 局部树：线上形状与序列化（S2）。

局部树是插件挂进权威根树的最小单位：一个 owner 从某个 slot 挂一棵子树。
本模块只定义线上形状与 Python 序列化；把局部树链接成权威根树在 TS 侧。

线上形状以 `app/sdk/tests/fixtures/local-trees.json` 为跨语言契约：
顶层 `{kind: 'local-trees', seq, trees}`，每棵树带 owner / mountAt / order / seq /
root，replace 为 True 时才出现。序列化结果必须与 fixture 完全相等。
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from .document import (
    Collection,
    JsonObject,
    Register,
    Slot,
    _non_empty,
    _require,
)
from .document_io import serialize_slot


def _is_int(value: object) -> bool:
    """int 但不是 bool：bool 是 int 的子类，线上形状不接受它冒充整数。"""
    return isinstance(value, int) and not isinstance(value, bool)


@dataclass(frozen=True)
class LocalTree:
    """一棵局部树：owner 从 mount_at 指向的 slot 挂进来的子树。

    root.owner 必须等于树 owner；children 可以属于别的 owner。
    order / seq 决定同一 slot 上的排序与同序时的到达顺序。
    """

    owner: str
    root: Slot
    mount_at: str
    order: int = 0
    seq: int = 0
    replace: bool = False

    def __post_init__(self) -> None:
        _non_empty(self.owner, "local_tree.owner")
        _non_empty(self.mount_at, "local_tree.mountAt")
        _require(isinstance(self.root, Slot), "local_tree.root 必须是 Slot")
        _require(
            self.root.owner == self.owner,
            f"local_tree.root.owner 必须等于 owner: {self.root.owner!r}",
        )
        _require(_is_int(self.order), "local_tree.order 必须是 int")
        _require(_is_int(self.seq), "local_tree.seq 必须是 int")
        _require(isinstance(self.replace, bool), "local_tree.replace 必须是 bool")


def _collect_slot_ids(slot: object, seen: set[str]) -> None:
    """收集子树里的 id；children 与 collection.templates 都算。

    非 Slot 的脏结构在这里跳过，交给 serialize_slot 报形状错误；
    id 不是非空字符串时也跳过，避免把形状错误报成重复 id。
    """
    if not isinstance(slot, Slot):
        return
    if isinstance(slot.id, str) and slot.id.strip():
        _require(slot.id not in seen, f"重复 id: {slot.id}")
        seen.add(slot.id)
    collection = slot.collection
    if isinstance(collection, Collection):
        for template in collection.templates.values():
            _collect_slot_ids(template, seen)
    for child in slot.children:
        _collect_slot_ids(child, seen)


def _serialize_tree(tree: LocalTree, register: Register) -> JsonObject:
    out: JsonObject = {
        "owner": tree.owner,
        "mountAt": tree.mount_at,
        "order": tree.order,
        "seq": tree.seq,
    }
    if tree.replace:
        out["replace"] = True
    out["root"] = serialize_slot(tree.root, register)
    return out


def serialize_local_trees(
    trees: Sequence[LocalTree], register: Register, seq: int = 1
) -> JsonObject:
    """多棵局部树 → local-trees 的线上 payload。

    空 trees 合法（清空语义）；seq 是 payload 版本，必须是非负 int。
    id 跨树全局唯一，重复抛 DocumentError 且不产出任何树。
    """
    _require(_is_int(seq) and seq >= 0, "seq 必须是 >= 0 的 int")
    _require(
        isinstance(trees, Sequence) and not isinstance(trees, (str, bytes)),
        "trees 必须是序列",
    )
    for tree in trees:
        _require(isinstance(tree, LocalTree), "trees 里只能是 LocalTree")
    seen: set[str] = set()
    for tree in trees:
        _collect_slot_ids(tree.root, seen)
    return {
        "kind": "local-trees",
        "seq": seq,
        "trees": [_serialize_tree(tree, register) for tree in trees],
    }


__all__ = ["LocalTree", "serialize_local_trees"]
