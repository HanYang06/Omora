"""V1 文档差分：settings / mount / unmount 的最小 ops。"""

from __future__ import annotations

from typing import Any

from omora.sdk.tree_diff import diff_documents, needs_full

ROOT = "a" * 16
ONE = "1" * 16
TWO = "2" * 16
GRAND = "3" * 16


def node(
    node_id: str,
    *,
    parent: str = ROOT,
    settings: dict[str, Any] | None = None,
    layout: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "id": node_id,
        "chain": f"{parent}.{node_id}",
        "kind": "text",
        "order": 10,
        "layout": [] if layout is None else layout,
        "settings": {} if settings is None else settings,
        "bind": {},
        "on": {},
        "emit": {},
    }


def document(*children: dict[str, Any]) -> dict[str, Any]:
    root = {
        "id": ROOT,
        "chain": ROOT,
        "kind": "app",
        "order": 0,
        "layout": list(children),
        "settings": {},
        "bind": {},
        "on": {},
        "emit": {},
    }
    return {
        "schema": "dendro.tree/1",
        "version": 1,
        "root": root,
        "pages": [],
        "active": "",
        "data": {},
    }


def test_settings_change_becomes_set_props() -> None:
    ops = diff_documents(
        document(node(ONE, settings={"text": "甲"})),
        document(node(ONE, settings={"text": "乙", "tone": "muted"})),
    )

    assert ops == [
        {"op": "setProps", "id": ONE, "props": {"text": "乙", "tone": "muted"}},
    ]


def test_replaced_child_becomes_unmount_and_mount() -> None:
    ops = diff_documents(document(node(ONE)), document(node(TWO)))

    assert ops == [
        {"op": "unmount", "id": ONE},
        {"op": "mount", "parent": ROOT, "node": node(TWO)},
    ]


def test_added_subtree_is_one_mount() -> None:
    grand = node(GRAND, parent=TWO, settings={"text": "孙"})
    child = node(TWO, layout=[grand])

    ops = diff_documents(document(), document(child))

    assert ops == [{"op": "mount", "parent": ROOT, "node": child}]


def test_unchanged_document_has_no_ops() -> None:
    assert diff_documents(document(node(ONE)), document(node(ONE))) == []


def test_reorder_needs_full() -> None:
    first = node(ONE)
    second = node(TWO)

    assert needs_full(document(first, second), document(second, first)) is True


def test_handler_change_needs_full() -> None:
    before = node(ONE)
    before["on"] = {"click": "h1"}
    after = node(ONE)
    after["on"] = {"click": "h2"}

    assert needs_full(document(before), document(after)) is True


def test_mount_does_not_need_full() -> None:
    assert needs_full(document(node(ONE)), document(node(ONE), node(TWO))) is False


def test_settings_change_does_not_need_full() -> None:
    before = node(ONE, settings={"text": "甲"})
    after = node(ONE, settings={"text": "乙"})

    assert needs_full(document(before), document(after)) is False
