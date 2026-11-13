"""Dendrolink 更新操作：线上形状与序列化（S3-a / S3-c）。

一次更新是一个原子批量：`update` / `mount` / `move` / `unmount` / `replace` /
`route` 按声明序应用，只涨一个文档版本。本模块只定义线上形状与 Python
序列化；把 ops 应用到文档树、维护索引与诊断在 TS 运行时。

线上形状以两份跨语言 fixture 为契约：`app/sdk/tests/fixtures/ops.json`
（树 ops）与 `app/sdk/tests/fixtures/route.json`（route op）。顶层
`{kind: 'ops', document, base, seq, ops}`，`base` 是客户端当前版本，
`document` 必须是 `base + 1`。序列化结果必须与 fixture 完全相等。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, cast

from .document import DocumentError, JsonObject, Register, Slot, _non_empty, _require
from .document_io import serialize_slot


def _is_int(value: object) -> bool:
    """int 但不是 bool：bool 是 int 的子类，线上形状不接受它冒充整数。"""
    return isinstance(value, int) and not isinstance(value, bool)


def _at(value: object, where: str) -> int:
    """位置必须是非负 int；0 是合法位置（首位），不能被当成缺省。"""
    _require(
        isinstance(value, int) and not isinstance(value, bool) and value >= 0,
        f"{where} 必须是 >= 0 的 int",
    )
    return cast(int, value)


def _plain(value: object) -> Any:
    """深拷成普通 dict / list：外部再改原对象不影响已保存的数据。"""
    if isinstance(value, Mapping):
        return {key: _plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(item) for item in value]
    return value


@dataclass(frozen=True)
class UpdateOp:
    """改一个节点的 props；只做浅合并。"""

    id: str
    props: Mapping[str, Any]

    def __post_init__(self) -> None:
        _non_empty(self.id, "update.id")
        _require(isinstance(self.props, Mapping), "update.props 必须是对象")
        object.__setattr__(self, "props", dict(self.props))


@dataclass(frozen=True)
class MountOp:
    """在 slot 的 at 位置插一棵子树；at 为 None 表示尾部。"""

    slot: str
    node: Slot
    at: int | None = None

    def __post_init__(self) -> None:
        _non_empty(self.slot, "mount.slot")
        _require(isinstance(self.node, Slot), "mount.node 必须是 Slot")
        if self.at is not None:
            _at(self.at, "mount.at")


@dataclass(frozen=True)
class MoveOp:
    """把 id 挪到 slot 的 at 位置：先删后插。"""

    id: str
    slot: str
    at: int

    def __post_init__(self) -> None:
        _non_empty(self.id, "move.id")
        _non_empty(self.slot, "move.slot")
        _at(self.at, "move.at")


@dataclass(frozen=True)
class UnmountOp:
    """删掉 id 指向的整棵子树。"""

    id: str

    def __post_init__(self) -> None:
        _non_empty(self.id, "unmount.id")


@dataclass(frozen=True)
class ReplaceOp:
    """用 node 整棵替换 id 指向的节点；位置不变。"""

    id: str
    node: Slot

    def __post_init__(self) -> None:
        _non_empty(self.id, "replace.id")
        _require(isinstance(self.node, Slot), "replace.node 必须是 Slot")


@dataclass(frozen=True)
class RouteOp:
    """页面切换意图：切到 page，params 是目标页的寻址参数。

    引擎把它展开成 page slot 的按 id 协调；本模块只管线上形状。
    params 为 None 时线上不出现该键，空对象 `{}` 则照常输出——
    “没带参数”和“参数是空对象”在线上是两种形状。
    """

    page: str
    params: Mapping[str, Any] | None = None

    def __post_init__(self) -> None:
        _non_empty(self.page, "route.page")
        if self.params is not None:
            _require(isinstance(self.params, Mapping), "route.params 必须是对象")
            object.__setattr__(self, "params", _plain(self.params))


Op = UpdateOp | MountOp | MoveOp | UnmountOp | ReplaceOp | RouteOp


def _serialize_op(op: object, register: Register) -> JsonObject:
    match op:
        case UpdateOp():
            return {"op": "update", "id": op.id, "props": dict(op.props)}
        case MountOp():
            out: JsonObject = {"op": "mount", "slot": op.slot}
            if op.at is not None:
                out["at"] = op.at
            out["node"] = serialize_slot(op.node, register)
            return out
        case MoveOp():
            return {"op": "move", "id": op.id, "slot": op.slot, "at": op.at}
        case UnmountOp():
            return {"op": "unmount", "id": op.id}
        case ReplaceOp():
            return {"op": "replace", "id": op.id, "node": serialize_slot(op.node, register)}
        case RouteOp():
            route: JsonObject = {"op": "route", "page": op.page}
            if op.params is not None:
                route["params"] = _plain(op.params)
            return route
    raise DocumentError(f"未知的 op: {op!r}")


def serialize_ops(
    ops: Sequence[Op],
    *,
    document: int,
    base: int,
    seq: int,
    register: Register,
) -> JsonObject:
    """一批更新操作 → ops 的线上 payload。

    base 是客户端当前文档版本，document 必须是 base + 1；seq 是更新序号，
    必须是非负 int。空 ops 合法（一次不改变树的批量）。op 顺序 = 声明顺序。
    节点仍走 serialize_slot，重复 id / 坏 kind 照旧抛 DocumentError。
    """
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
        "ops": [_serialize_op(op, register) for op in ops],
    }


__all__ = [
    "MountOp",
    "MoveOp",
    "Op",
    "ReplaceOp",
    "RouteOp",
    "UnmountOp",
    "UpdateOp",
    "serialize_ops",
]
