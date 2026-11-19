"""生成物：树格式 V1 的 Python 类型与常量。不要手改。

来源：schema/tree/tree.schema.json；重新生成：
    uv run python scripts/tree_schema.py
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

SCHEMA = "dendro.tree/1"
ID_PATTERN = "^[0-9a-f]{16}$"
CHAIN_PATTERN = "^[0-9a-f]{16}(\\.[0-9a-f]{16})*$"
ID_FIELD = "id"
CHAIN_FIELD = "chain"
ORDER_FIELD = "order"
LAYOUT_FIELD = "layout"
NON_NESTING_FIELDS = (
    "settings",
    "bind",
    "on",
    "emit",
)
ROOT_KIND = "app"
MOUNT_MODES = (
    "new",
    "overlay",
)


@dataclass(frozen=True)
class Placement:
    size: Mapping[str, str | int | float] = field(default_factory=dict)
    align: str | None = None
    span: int | None = None


@dataclass(frozen=True)
class A11y:
    role: str | None = None
    label: str | None = None
    description: str | None = None


@dataclass(frozen=True)
class Node:
    id: str
    chain: str
    kind: str
    order: int
    layout: tuple[Node, ...]
    settings: Mapping[str, Any]
    bind: Mapping[str, Any]
    on: Mapping[str, Any]
    emit: Mapping[str, Any]
    title: str | None = None
    slot: Placement | None = None
    collection: Collection | None = None
    i18n: Mapping[str, str] = field(default_factory=dict)
    a11y: A11y | None = None


@dataclass(frozen=True)
class Page:
    id: str
    title: str
    route: str


@dataclass(frozen=True)
class LedgerEntry:
    source: str
    fields: Mapping[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class Mount:
    parent: str
    mode: str


@dataclass(frozen=True)
class Collection:
    source: str
    key: str
    select: str | None = None
    templates: Mapping[str, Node] = field(default_factory=dict)
    virtual: bool | None = None


@dataclass(frozen=True)
class Document:
    schema: str
    version: int
    root: Node
    pages: tuple[Page, ...]
    active: str
    data: Mapping[str, Any]
    messages: Mapping[str, str] = field(default_factory=dict)
    locale: str | None = None
    ledger: Mapping[str, LedgerEntry] = field(default_factory=dict)


@dataclass(frozen=True)
class Partial:
    schema: str
    source: str
    mount: Mount
    root: Node


__all__ = [
    "CHAIN_FIELD",
    "CHAIN_PATTERN",
    "ID_FIELD",
    "ID_PATTERN",
    "LAYOUT_FIELD",
    "MOUNT_MODES",
    "NON_NESTING_FIELDS",
    "ORDER_FIELD",
    "ROOT_KIND",
    "SCHEMA",
    "A11y",
    "Collection",
    "Document",
    "LedgerEntry",
    "Mount",
    "Node",
    "Page",
    "Partial",
    "Placement",
]
