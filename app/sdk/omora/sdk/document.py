"""Dendrolink v2 文档契约：Slot 文档、序列化与校验（S1.1）。

这是目标契约的第一块实现：只定义线上形状与校验，不接入现有 v1 运行时。
命名空间是 `dendro.ui/1`；引擎 kind 用 `dendro:*`，宿主/领域 kind 用 `ideas:*`。

与 v1 的关系：`omora.sdk.ui` 的 Node / Page 仍是当前运行时的节点；本模块的 Slot
是 v2 通用节点，后续序列化会迁到这里。
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

Handler = Callable[[dict[str, Any]], None]
JsonObject = dict[str, Any]
Register = Callable[[Handler], str]

SCHEMA = "dendro.ui/1"
_KIND_PARTS = 2
FLOWS = frozenset({"column", "row", "stack", "none"})
CAPACITIES = frozenset({"none", "one", "many"})
ALIGNS = frozenset({"start", "center", "stretch"})
SCROLLS = frozenset({"none", "x", "y"})
CAPABILITIES = frozenset({"read", "mount", "replace", "update", "remove", "observe", "intercept"})


class DocumentError(ValueError):
    """文档形状不合法。"""


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise DocumentError(message)


def _non_empty(value: object, where: str) -> str:
    _require(isinstance(value, str) and value.strip() != "", f"{where} 必须是非空字符串")
    return str(value)


@dataclass(frozen=True)
class Layout:
    """一个 Slot 的排布描述；只有容器与文档节点需要。"""

    flow: str = "column"
    size: Mapping[str, Any] | None = None
    gap: str | None = None
    align: str | None = None
    scroll: str | None = None
    capacity: str = "many"

    def __post_init__(self) -> None:
        _require(self.flow in FLOWS, f"layout.flow 不合法: {self.flow}")
        _require(self.capacity in CAPACITIES, f"layout.capacity 不合法: {self.capacity}")
        if self.align is not None:
            _require(self.align in ALIGNS, f"layout.align 不合法: {self.align}")
        if self.scroll is not None:
            _require(self.scroll in SCROLLS, f"layout.scroll 不合法: {self.scroll}")
        if self.gap is not None:
            _non_empty(self.gap, "layout.gap")
        if self.size is not None:
            for key, value in self.size.items():
                _non_empty(key, "layout.size 的键")
                _require(
                    isinstance(value, (str, int, float)),
                    f"layout.size.{key} 必须是字符串或数字",
                )

    def to_json(self) -> JsonObject:
        out: JsonObject = {"flow": self.flow, "capacity": self.capacity}
        if self.size is not None:
            out["size"] = dict(self.size)
        if self.gap is not None:
            out["gap"] = self.gap
        if self.align is not None:
            out["align"] = self.align
        if self.scroll is not None:
            out["scroll"] = self.scroll
        return out


@dataclass(frozen=True)
class Input:
    """信息流入口：这个 Slot 消费哪个数据源的哪一片。"""

    source: str
    path: str | None = None

    def __post_init__(self) -> None:
        _non_empty(self.source, "input.source")
        if self.path is not None:
            _non_empty(self.path, "input.path")

    def to_json(self) -> JsonObject:
        out: JsonObject = {"source": self.source}
        if self.path is not None:
            out["path"] = self.path
        return out


@dataclass(frozen=True)
class Reaction:
    """触发 → 一组效果。效果本身由引擎执行，不在这里求值。"""

    on: Mapping[str, Any]
    do: Sequence[Mapping[str, Any]]

    def __post_init__(self) -> None:
        _require(len(self.on) == 1, "reaction.on 必须只有一个触发键")
        _require(len(self.do) > 0, "reaction.do 不能为空")
        for effect in self.do:
            _require(
                isinstance(effect, Mapping) and len(effect) > 0,
                "reaction.do 的每一项必须是非空对象",
            )

    def to_json(self) -> JsonObject:
        return {"on": dict(self.on), "do": [dict(effect) for effect in self.do]}


@dataclass(frozen=True)
class Collection:
    """集合绑定：数据按 key 用模板实例化。"""

    source: str
    key: str
    templates: Mapping[str, Slot]
    select: str = "template"

    def __post_init__(self) -> None:
        _non_empty(self.source, "collection.source")
        _non_empty(self.key, "collection.key")
        _non_empty(self.select, "collection.select")
        _require(len(self.templates) > 0, "collection.templates 不能为空")


@dataclass(frozen=True)
class Grant:
    """权限：能力 → 主体列表。"""

    capabilities: Mapping[str, Sequence[str]]

    def __post_init__(self) -> None:
        for name, subjects in self.capabilities.items():
            _require(name in CAPABILITIES, f"未知能力: {name}")
            _require(
                isinstance(subjects, Sequence)
                and all(isinstance(item, str) and item.strip() for item in subjects),
                f"grant.{name} 必须是字符串数组",
            )

    def to_json(self) -> JsonObject:
        return {name: list(subjects) for name, subjects in self.capabilities.items()}


@dataclass(frozen=True, init=False)
class Slot:
    """Dendrolink 的唯一节点原语。

    id/owner/kind 必填；props 是静态数据；binding 把 prop 映射到作用域内的数据路径；
    events 里的回调在序列化时换成 handler id。
    """

    id: str
    kind: str
    owner: str
    props: JsonObject
    children: tuple[Slot, ...]
    scope: str | None
    binding: Mapping[str, str] | None
    layout: Layout | None
    inputs: tuple[Input, ...]
    events: Mapping[str, Handler]
    reactions: tuple[Reaction, ...]
    collection: Collection | None
    grant: Grant | None

    def __init__(  # noqa: PLR0913 —— 通用 Slot 信封的声明式参数
        self,
        id: str,
        kind: str,
        *,
        owner: str,
        props: Mapping[str, Any] | None = None,
        children: Sequence[Slot] = (),
        scope: str | None = None,
        binding: Mapping[str, str] | None = None,
        layout: Layout | None = None,
        inputs: Sequence[Input] = (),
        events: Mapping[str, Handler] | None = None,
        reactions: Sequence[Reaction] = (),
        collection: Collection | None = None,
        grant: Grant | None = None,
    ) -> None:
        object.__setattr__(self, "id", id)
        object.__setattr__(self, "kind", kind)
        object.__setattr__(self, "owner", owner)
        object.__setattr__(self, "props", dict(props or {}))
        object.__setattr__(self, "children", tuple(children))
        object.__setattr__(self, "scope", scope)
        object.__setattr__(self, "binding", dict(binding) if binding is not None else None)
        object.__setattr__(self, "layout", layout)
        object.__setattr__(self, "inputs", tuple(inputs))
        object.__setattr__(self, "events", dict(events or {}))
        object.__setattr__(self, "reactions", tuple(reactions))
        object.__setattr__(self, "collection", collection)
        object.__setattr__(self, "grant", grant)


@dataclass(frozen=True, init=False)
class PageEntry:
    """导航侧表的一项；与页面根节点共用同一个 id。"""

    id: str
    label: str
    route: str
    owner: str
    icon: str | None

    def __init__(
        self, id: str, label: str, *, route: str, owner: str, icon: str | None = None
    ) -> None:
        object.__setattr__(self, "id", id)
        object.__setattr__(self, "label", label)
        object.__setattr__(self, "route", route)
        object.__setattr__(self, "owner", owner)
        object.__setattr__(self, "icon", icon)

    def to_json(self) -> JsonObject:
        out: JsonObject = {
            "id": self.id,
            "label": self.label,
            "route": self.route,
            "owner": self.owner,
        }
        if self.icon is not None:
            out["icon"] = self.icon
        return out


@dataclass(frozen=True, init=False)
class Document:
    """一份权威文档的线上形态：根树 + 页面侧表 + 数据文档 + 版本。"""

    root: Slot
    pages: tuple[PageEntry, ...]
    active: str
    data: JsonObject
    version: int
    schema: str

    def __init__(  # noqa: PLR0913 —— 文档信封的声明式参数
        self,
        root: Slot,
        *,
        active: str,
        pages: Sequence[PageEntry] = (),
        data: Mapping[str, Any] | None = None,
        version: int = 1,
        schema: str = SCHEMA,
    ) -> None:
        object.__setattr__(self, "root", root)
        object.__setattr__(self, "pages", tuple(pages))
        object.__setattr__(self, "active", active)
        object.__setattr__(self, "data", dict(data or {}))
        object.__setattr__(self, "version", version)
        object.__setattr__(self, "schema", schema)


__all__ = [
    "CAPABILITIES",
    "CAPACITIES",
    "SCHEMA",
    "Collection",
    "Document",
    "DocumentError",
    "Grant",
    "Input",
    "Layout",
    "PageEntry",
    "Reaction",
    "Slot",
]
