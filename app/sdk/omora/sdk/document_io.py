"""Dendrolink v2 文档契约的序列化与校验（S1.1）。

类型定义在 §document.py§；本模块只做“校验 + 生成线上形状”，
与 Python 端 v1 运行时无关，后续 S1.2 才接入序列化链路。
"""

from __future__ import annotations

from collections.abc import Mapping

from .document import (
    _KIND_PARTS,
    SCHEMA,
    Collection,
    Document,
    Grant,
    Input,
    JsonObject,
    Layout,
    PageEntry,
    Reaction,
    Register,
    Slot,
    _non_empty,
    _require,
)


def _check_binding(binding: Mapping[str, str], where: str) -> None:
    for name, path in binding.items():
        _non_empty(name, f"{where}.bind 的键")
        _non_empty(path, f"{where}.bind.{name}")


def _validate_slot(slot: Slot, seen: set[str]) -> None:
    _require(isinstance(slot, Slot), "children 只能是 Slot")
    slot_id = _non_empty(slot.id, "slot.id")
    _require(slot_id not in seen, f"重复 id: {slot_id}")
    seen.add(slot_id)

    kind = _non_empty(slot.kind, f"{slot_id}.kind")
    parts = kind.split(":")
    _require(
        len(parts) == _KIND_PARTS and all(part.strip() for part in parts),
        f"{slot_id}.kind 必须是 命名空间:名字，实际是 {kind!r}",
    )
    _non_empty(slot.owner, f"{slot_id}.owner")
    if slot.scope is not None:
        _non_empty(slot.scope, f"{slot_id}.scope")
    if slot.binding is not None:
        _check_binding(slot.binding, slot_id)
    if slot.layout is not None:
        _require(isinstance(slot.layout, Layout), f"{slot_id}.layout 类型不对")
    for input_ in slot.inputs:
        _require(isinstance(input_, Input), f"{slot_id}.in 的类型不对")
    for name, handler in slot.events.items():
        _non_empty(name, f"{slot_id}.events 的事件名")
        _require(callable(handler), f"{slot_id}.events.{name} 必须是可调用对象")
    for reaction in slot.reactions:
        _require(isinstance(reaction, Reaction), f"{slot_id}.reactions 的类型不对")
    if slot.grant is not None:
        _require(isinstance(slot.grant, Grant), f"{slot_id}.grant 的类型不对")
    if slot.collection is not None:
        _require(isinstance(slot.collection, Collection), f"{slot_id}.collection 的类型不对")
        for name, template in slot.collection.templates.items():
            _non_empty(name, f"{slot_id}.collection.templates 的键")
            _validate_slot(template, seen)
    for child in slot.children:
        _validate_slot(child, seen)


def _serialize_slot(slot: Slot, register: Register) -> JsonObject:
    out: JsonObject = {
        "id": slot.id,
        "kind": slot.kind,
        "owner": slot.owner,
        "props": dict(slot.props),
    }
    if slot.scope is not None:
        out["scope"] = slot.scope
    if slot.binding is not None:
        out["bind"] = dict(slot.binding)
    if slot.layout is not None:
        out["layout"] = slot.layout.to_json()
    if slot.inputs:
        out["in"] = [item.to_json() for item in slot.inputs]
    if slot.events:
        out["events"] = {name: register(handler) for name, handler in slot.events.items()}
    if slot.reactions:
        out["reactions"] = [reaction.to_json() for reaction in slot.reactions]
    if slot.grant is not None:
        out["grant"] = slot.grant.to_json()
    if slot.collection is not None:
        out["collection"] = {
            "source": slot.collection.source,
            "key": slot.collection.key,
            "templates": {
                name: _serialize_slot(template, register)
                for name, template in slot.collection.templates.items()
            },
            "select": slot.collection.select,
        }
    out["children"] = [_serialize_slot(child, register) for child in slot.children]
    return out


def serialize_slot(slot: Slot, register: Register) -> JsonObject:
    """一个 Slot → v2 线上形状；重复 id / 坏 kind 会抛 DocumentError。"""
    _validate_slot(slot, set())
    return _serialize_slot(slot, register)


def _validate_document(document: Document) -> None:
    _require(isinstance(document, Document), "document 类型不对")
    _require(document.schema == SCHEMA, f"schema 必须是 {SCHEMA}")
    _require(isinstance(document.version, int) and document.version >= 1, "version 必须是正整数")
    _require(isinstance(document.data, dict), "data 必须是对象")

    page_ids: set[str] = set()
    for page in document.pages:
        _require(isinstance(page, PageEntry), "pages 里只能是 PageEntry")
        page_id = _non_empty(page.id, "page.id")
        _require(page_id not in page_ids, f"重复页面 id: {page_id}")
        page_ids.add(page_id)
        _non_empty(page.label, f"{page_id}.label")
        _non_empty(page.route, f"{page_id}.route")
        _non_empty(page.owner, f"{page_id}.owner")
        if page.icon is not None:
            _non_empty(page.icon, f"{page_id}.icon")

    if document.pages:
        _require(document.active in page_ids, f"active 不在 pages 里: {document.active!r}")
    else:
        _require(document.active == "", "没有页面时 active 必须是空串")

    _validate_slot(document.root, set())


def serialize_document(document: Document, register: Register) -> JsonObject:
    """一份文档 → v2 线上形状；根树、模板、页面侧表一起校验。"""
    _validate_document(document)
    return {
        "schema": document.schema,
        "document": _serialize_slot(document.root, register),
        "pages": [page.to_json() for page in document.pages],
        "active": document.active,
        "data": document.data,
        "version": document.version,
    }


__all__ = ["serialize_document", "serialize_slot"]
