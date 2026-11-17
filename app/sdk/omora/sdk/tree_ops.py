"""树格式 V1 的更新操作：线上形状与 Python 序列化。

一次更新是一个原子批量：`setProps` / `mount` / `unmount` / `replace` / `data`
按声明序应用，只涨一个文档版本。本模块只定义线上形状与序列化；把 ops 应用到
`dendro.tree/1` 文档、维护索引与诊断在 TS 运行时（下一步）。

线上形状以 `app/sdk/tests/fixtures/tree-ops.json` 为跨语言契约。顶层
`{kind: "ops", document, base, seq, ops}`；`base` 是客户端当前版本，
`document` 必须是 `base + 1`；`seq` 是来源内声明序，非负 int。空 ops 合法
（一次不改变结构、但仍推进版本的批量）。

节点仍用 `dendro.tree/1` 的形状（带 chain）：ops 是“按 id 改文档”，不是再造
一套节点。节点自己的 chain / id 在这里校验；与目标父链的一致性由应用端校验。
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, cast

from .tree import parse_node
from .tree_generated import ID_PATTERN

_ID = re.compile(ID_PATTERN)
_UNSET = object()


def _is_int(value: object) -> bool:
    """int 但不是 bool：bool 是 int 的子类，线上形状不接受它冒充整数。"""
    return isinstance(value, int) and not isinstance(value, bool)


def _plain(value: object) -> Any:
    """深拷成普通 dict / list：外部再改原对象不影响已保存的数据。"""
    if isinstance(value, Mapping):
        return {key: _plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(item) for item in value]
    return value


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def _identity(value: object, where: str) -> str:
    _require(isinstance(value, str) and value.strip() != "", f"{where} 必须是非空字符串")
    text = cast(str, value)
    _require(_ID.fullmatch(text) is not None, f"{where} 必须是 16 位小写十六进制")
    return text


def _node(value: object, where: str) -> dict[str, Any]:
    """节点载荷：按 `dendro.tree/1` 节点校验后深拷（不给 applier 留可变引用）。"""
    _require(isinstance(value, Mapping), f"{where} 必须是对象")
    parse_node(value, where)
    return cast(dict[str, Any], _plain(value))


def _revision(value: object) -> int:
    _require(_is_int(value), "data.revision 必须是 >= 0 的 int")
    revision = cast(int, value)
    _require(revision >= 0, "data.revision 必须是 >= 0 的 int")
    return revision


@dataclass(frozen=True)
class SetPropsOp:
    """改一个节点的 settings；浅合并，保留未提到的键。"""

    id: str
    props: Mapping[str, Any]

    def __post_init__(self) -> None:
        object.__setattr__(self, "id", _identity(self.id, "setProps.id"))
        _require(isinstance(self.props, Mapping), "setProps.props 必须是对象")
        object.__setattr__(self, "props", _plain(self.props))


@dataclass(frozen=True)
class MountOp:
    """把一棵子树挂到 parent 的 layout；位置由 node.order 决定。"""

    parent: str
    node: Mapping[str, Any]

    def __post_init__(self) -> None:
        object.__setattr__(self, "parent", _identity(self.parent, "mount.parent"))
        object.__setattr__(self, "node", _node(self.node, "mount.node"))


@dataclass(frozen=True)
class UnmountOp:
    """摘掉 id 指向的整棵子树；根不能卸。"""

    id: str

    def __post_init__(self) -> None:
        object.__setattr__(self, "id", _identity(self.id, "unmount.id"))


@dataclass(frozen=True)
class ReplaceOp:
    """用 node 整棵替换 id 指向的节点；位置不变，id 可以换。"""

    id: str
    node: Mapping[str, Any]

    def __post_init__(self) -> None:
        object.__setattr__(self, "id", _identity(self.id, "replace.id"))
        object.__setattr__(self, "node", _node(self.node, "replace.node"))


@dataclass(frozen=True)
class DataOp:
    """纯数据更新：source + revision，外加 value / items / changes 恰好一个。"""

    source: str
    revision: int
    value: Any = _UNSET
    items: Sequence[Mapping[str, Any]] | None = None
    changes: Sequence[Mapping[str, Any]] | None = None

    def __post_init__(self) -> None:
        _require(
            isinstance(self.source, str) and self.source.strip() != "",
            "data.source 必须是非空字符串",
        )
        object.__setattr__(self, "revision", _revision(self.revision))
        supplied = sum(
            (
                self.value is not _UNSET,
                self.items is not None,
                self.changes is not None,
            )
        )
        _require(supplied == 1, "data 必须且只能有 value / items / changes 之一")
        if self.value is not _UNSET:
            object.__setattr__(self, "value", _plain(self.value))
        if self.items is not None:
            object.__setattr__(self, "items", _objects(self.items, "data.items"))
        if self.changes is not None:
            object.__setattr__(self, "changes", _objects(self.changes, "data.changes"))


def _objects(value: object, where: str) -> list[dict[str, Any]]:
    _require(
        isinstance(value, Sequence) and not isinstance(value, (str, bytes)),
        f"{where} 必须是序列",
    )
    out: list[dict[str, Any]] = []
    for item in cast(Sequence[object], value):
        _require(isinstance(item, Mapping), f"{where} 的每一项必须是对象")
        out.append(cast(dict[str, Any], _plain(item)))
    return out


Op = SetPropsOp | MountOp | UnmountOp | ReplaceOp | DataOp


def _serialize_op(op: object) -> dict[str, Any]:
    match op:
        case SetPropsOp():
            return {"op": "setProps", "id": op.id, "props": dict(op.props)}
        case MountOp():
            return {"op": "mount", "parent": op.parent, "node": dict(op.node)}
        case UnmountOp():
            return {"op": "unmount", "id": op.id}
        case ReplaceOp():
            return {"op": "replace", "id": op.id, "node": dict(op.node)}
        case DataOp():
            out: dict[str, Any] = {
                "op": "data",
                "source": op.source,
                "revision": op.revision,
            }
            if op.value is not _UNSET:
                out["value"] = op.value
            if op.items is not None:
                out["items"] = list(op.items)
            if op.changes is not None:
                out["changes"] = list(op.changes)
            return out
    raise ValueError(f"未知的 op: {op!r}")


def serialize_ops(
    ops: Sequence[Op],
    *,
    document: int,
    base: int,
    seq: int,
) -> dict[str, Any]:
    """一批更新操作 → ops 线上 payload；序列化结果必须与共享 fixture 完全相等。"""
    _require(_is_int(document), "document 必须是 int")
    _require(_is_int(base) and base >= 1, "base 必须是 >= 1 的 int")
    _require(_is_int(seq) and seq >= 0, "seq 必须是 >= 0 的 int")
    _require(document == base + 1, "document 必须等于 base + 1")
    _require(
        isinstance(ops, Sequence) and not isinstance(ops, (str, bytes)),
        "ops 必须是序列",
    )
    return {
        "kind": "ops",
        "document": document,
        "base": base,
        "seq": seq,
        "ops": [_serialize_op(op) for op in cast(Sequence[object], ops)],
    }


__all__ = [
    "DataOp",
    "MountOp",
    "Op",
    "ReplaceOp",
    "SetPropsOp",
    "UnmountOp",
    "serialize_ops",
]
