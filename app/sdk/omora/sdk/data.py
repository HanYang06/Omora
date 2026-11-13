"""Dendrolink 纯数据更新：线上形状与序列化（S3-b）。

纯数据更新只描述“哪个数据源的什么变了”，不携带任何结构：标量写 `value`，
集合写全量 `items` 或增量 `changes`。引擎按 source 找消费它的视图
（`in` / 集合绑定），本模块只定义线上形状与 Python 序列化。

线上形状以 `app/sdk/tests/fixtures/data.json` 为跨语言契约：一个数组，
每项是 `{kind: 'data', owner, source, revision}` 加上 `value` / `items` /
`changes` 里恰好一个。序列化结果必须与 fixture 完全相等。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, cast

from .document import DocumentError, JsonObject, _non_empty, _require


def _is_int(value: object) -> bool:
    """int 但不是 bool：bool 是 int 的子类，线上形状不接受它冒充整数。"""
    return isinstance(value, int) and not isinstance(value, bool)


def _is_sequence(value: object) -> bool:
    """序列但不是 str / bytes：字符串不是“一组条目”。"""
    return isinstance(value, Sequence) and not isinstance(value, (str, bytes))


def _revision(value: object) -> int:
    """数据源版本：非负 int；同 revision 重复到达幂等。"""
    _require(_is_int(value), "data.revision 必须是 >= 0 的 int")
    revision = cast(int, value)
    _require(revision >= 0, "data.revision 必须是 >= 0 的 int")
    return revision


def _plain(value: object) -> Any:
    """深拷成普通 dict / list：外部再改原对象不影响已保存的数据。"""
    if isinstance(value, Mapping):
        return {key: _plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(item) for item in value]
    return value


def _objects(value: object, where: str) -> list[dict[str, Any]]:
    """条目 / 增量必须是对象序列；每项深拷成普通 dict。"""
    _require(_is_sequence(value), f"{where} 必须是序列")
    out: list[dict[str, Any]] = []
    for item in cast(Sequence[object], value):
        _require(isinstance(item, Mapping), f"{where} 的每一项必须是对象")
        out.append(cast(dict[str, Any], _plain(item)))
    return out


def _identity(owner: object, source: object) -> None:
    _non_empty(owner, "data.owner")
    _non_empty(source, "data.source")


@dataclass(frozen=True)
class ScalarData:
    """一个数据源的整体标量（或对象）值，例如连接状态、播放进度。"""

    owner: str
    source: str
    revision: int
    value: Any

    def __post_init__(self) -> None:
        _identity(self.owner, self.source)
        object.__setattr__(self, "revision", _revision(self.revision))
        object.__setattr__(self, "value", _plain(self.value))


@dataclass(frozen=True)
class ItemsData:
    """集合的全量条目；全量永远可作为增量对不上的兜底。"""

    owner: str
    source: str
    revision: int
    items: Sequence[Mapping[str, Any]]

    def __post_init__(self) -> None:
        _identity(self.owner, self.source)
        object.__setattr__(self, "revision", _revision(self.revision))
        object.__setattr__(self, "items", _objects(self.items, "data.items"))


@dataclass(frozen=True)
class ChangesData:
    """集合的增量：insert / update / remove / move；key 在增量里必须稳定。"""

    owner: str
    source: str
    revision: int
    changes: Sequence[Mapping[str, Any]]

    def __post_init__(self) -> None:
        _identity(self.owner, self.source)
        object.__setattr__(self, "revision", _revision(self.revision))
        object.__setattr__(self, "changes", _objects(self.changes, "data.changes"))


DataUpdate = ScalarData | ItemsData | ChangesData


def _serialize_update(update: DataUpdate) -> JsonObject:
    match update:
        case ScalarData():
            return {
                "kind": "data",
                "owner": update.owner,
                "source": update.source,
                "revision": update.revision,
                "value": _plain(update.value),
            }
        case ItemsData():
            return {
                "kind": "data",
                "owner": update.owner,
                "source": update.source,
                "revision": update.revision,
                "items": [_plain(item) for item in update.items],
            }
        case ChangesData():
            return {
                "kind": "data",
                "owner": update.owner,
                "source": update.source,
                "revision": update.revision,
                "changes": [_plain(change) for change in update.changes],
            }
    raise DocumentError(f"未知的 data 更新: {update!r}")


def serialize_data(update: DataUpdate) -> JsonObject:
    """一条数据更新 → data 的线上 payload；value / items / changes 恰好一个。

    已保存的数据与返回的 payload 都是深拷，互相改不到对方。
    """
    return _serialize_update(update)


def serialize_data_updates(updates: Sequence[DataUpdate]) -> list[JsonObject]:
    """按到达顺序把一个数组的数据更新序列化成线上数组；空数组合法。"""
    _require(_is_sequence(updates), "data 更新必须是序列")
    for update in updates:
        _require(
            isinstance(update, (ScalarData, ItemsData, ChangesData)),
            "data 更新里只能是 ScalarData / ItemsData / ChangesData",
        )
    return [_serialize_update(update) for update in updates]


__all__ = [
    "ChangesData",
    "DataUpdate",
    "ItemsData",
    "ScalarData",
    "serialize_data",
    "serialize_data_updates",
]
