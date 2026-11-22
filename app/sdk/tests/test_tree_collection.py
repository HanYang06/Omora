"""集合槽的构建：模板不挂载、chain 挂在槽下、bind 进节点、handler 共享。"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest

from omora.sdk.node_bind import bound
from omora.sdk.tree_build import build_page, compose
from omora.sdk.ui import Card, Collection, Column, Page, Text

Register = Callable[[Callable[[dict[str, Any]], None], str, str], str]


def _build(built_page: Page, register: Register | None = None) -> dict[str, Any]:
    return build_page(
        name="feed",
        title="流",
        route="/feed",
        page=built_page,
        owner="ideas",
        nav=[],
        register=register,
    )


def _collection(built: dict[str, Any], source: str) -> dict[str, Any]:
    document = compose(built["base"], built["partials"])

    def walk(node: dict[str, Any]) -> dict[str, Any] | None:
        collection = node.get("collection")
        if isinstance(collection, dict) and collection.get("source") == source:
            return node
        for child in node["layout"]:
            found = walk(child)
            if found is not None:
                return found
        for template in node.get("collection", {}).get("templates", {}).values():
            found = walk(template)
            if found is not None:
                return found
        return None

    found = walk(document["root"])
    assert found is not None, f"文档里没有集合 {source}"
    return found


def test_a_slot_holds_templates_with_binds_and_no_mounted_children() -> None:
    card = bound(Card("占位", meta="占位"), title="item.title", meta="item.meta")
    built = _build(Page(content=Column(Collection("ideas.feed", "id", {"item": card}))))

    slot = _collection(built, "ideas.feed")
    collection = slot["collection"]

    assert (collection["source"], collection["key"], collection["select"]) == (
        "ideas.feed",
        "id",
        "template",
    )
    assert slot["layout"] == []
    template = collection["templates"]["item"]
    assert template["kind"] == "card"
    assert template["bind"] == {"title": "item.title", "meta": "item.meta"}
    assert template["chain"] == slot["chain"] + "." + template["id"]


def test_template_settings_stay_placeholders_and_do_not_leak_bind() -> None:
    text = bound(Text(text="占位"), text="item.title")
    built = _build(Page(content=Column(Collection("ideas.feed", "id", {"item": text}))))

    template = _collection(built, "ideas.feed")["collection"]["templates"]["item"]

    assert template["settings"] == {"text": "占位"}
    assert "bind_props" not in template["settings"]


def test_one_template_handler_is_registered_for_every_instance() -> None:
    registered: list[tuple[str, str]] = []

    def register(callback: Callable[[dict[str, Any]], None], node_id: str, event: str) -> str:
        handler = f"tree:{node_id}:{event}"
        registered.append((handler, event))
        return handler

    card = bound(Card("占位", on_click=lambda _payload: None), title="item.title")
    built = _build(Page(content=Column(Collection("ideas.feed", "id", {"item": card}))), register)

    template = _collection(built, "ideas.feed")["collection"]["templates"]["item"]

    assert registered == [(f"tree:{template['id']}:click", "click")]
    assert template["on"] == {"click": f"tree:{template['id']}:click"}


def test_collection_needs_source_key_templates_and_non_empty_binds() -> None:
    with pytest.raises(ValueError, match="source"):
        Collection("", "id", {"item": Text(text="x")})
    with pytest.raises(ValueError, match="至少要有一个模板"):
        Collection("feed", "id", {})
    with pytest.raises(ValueError, match="至少要一条绑定"):
        bound(Text(text="x"))
    with pytest.raises(ValueError, match=r"bind\.title"):
        bound(Text(text="x"), title="")
