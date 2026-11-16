"""根树结构文件 → 窗口骨架：锚点解析、id 校验、坏文件拒绝与路径覆盖。"""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

import pytest

from omora.sdk import root_tree, slot_tree
from omora.sdk.document import SCHEMA, DocumentError, JsonObject
from omora.sdk.root_tree import (
    NAV_MOUNT_AT,
    PAGE_MOUNT_AT,
    ROOT_ID,
    ROOT_KIND,
    ROOT_TREE,
    WINDOW_ANCHOR,
    anchor,
    ids,
    load_root_tree,
    parse_root_tree,
)


def _tree(
    *,
    root_id: str = "dendro.window",
    nav_id: str = "dendro.window.nav",
    page_id: str = "dendro.window.page",
    root_kind: str = ROOT_KIND,
    schema: str = SCHEMA,
    version: object = 1,
    anchors: object = None,
) -> JsonObject:
    """一份形状合法的根树；默认 id 与包内文件相同，测试按需改坏一处。"""
    resolved: object = (
        {"window": root_id, "nav": nav_id, "page": page_id} if anchors is None else anchors
    )
    return {
        "schema": schema,
        "version": version,
        "root": {
            "id": root_id,
            "kind": root_kind,
            "owner": "dendro",
            "props": {},
            "layout": {"flow": "row", "capacity": "many"},
            "children": [
                {
                    "id": nav_id,
                    "kind": "dendro:slot",
                    "owner": "dendro",
                    "props": {},
                    "layout": {
                        "flow": "column",
                        "capacity": "many",
                        "size": {"width": 56},
                        "gap": "xs",
                    },
                    "children": [],
                },
                {
                    "id": page_id,
                    "kind": "dendro:slot",
                    "owner": "dendro",
                    "props": {},
                    "layout": {
                        "flow": "column",
                        "capacity": "one",
                        "size": {"width": "fill"},
                    },
                    "children": [],
                },
            ],
        },
        "anchors": resolved,
    }


def _write(tmp_path: Path, data: object) -> Path:
    path = tmp_path / "root-tree.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def test_anchors_resolve_to_slots_that_exist_in_the_tree() -> None:
    for name in root_tree.REQUIRED_ANCHORS:
        assert anchor(name) in ids()
    assert anchor(WINDOW_ANCHOR) == ROOT_ID
    assert (anchor("nav"), anchor("page")) == (NAV_MOUNT_AT, PAGE_MOUNT_AT)


def test_the_package_file_is_a_three_slot_window_root() -> None:
    assert (ROOT_TREE.schema, ROOT_TREE.version) == (SCHEMA, 1)
    assert ROOT_TREE.root.kind == ROOT_KIND
    assert ids() == ("dendro.window", "dendro.window.nav", "dendro.window.page")


def test_slot_tree_mount_targets_are_derived_from_the_anchors() -> None:
    assert anchor(root_tree.NAV_ANCHOR) == slot_tree.NAV_MOUNT_AT
    assert anchor(root_tree.PAGE_ANCHOR) == slot_tree.PAGE_MOUNT_AT
    assert slot_tree.NAV_ROOT_ID == "ui.nav"


def test_unknown_anchor_name_is_rejected() -> None:
    with pytest.raises(DocumentError, match="没有锚点"):
        anchor("sidebar")


def test_path_override_loads_another_tree_without_touching_the_default(tmp_path: Path) -> None:
    other = _tree(
        root_id="test.window",
        nav_id="test.window.nav",
        page_id="test.window.page",
    )

    loaded = load_root_tree(_write(tmp_path, other))

    assert loaded.ids() == ("test.window", "test.window.nav", "test.window.page")
    assert loaded.anchor("nav") == "test.window.nav"
    assert ROOT_ID == "dendro.window"


def test_malformed_json_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / "root-tree.json"
    path.write_text("{ not json", encoding="utf-8")

    with pytest.raises(DocumentError, match="不是合法 JSON"):
        load_root_tree(path)


def test_missing_file_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(DocumentError, match="读不到根树结构文件"):
        load_root_tree(tmp_path / "missing.json")


def test_a_non_object_file_is_rejected() -> None:
    with pytest.raises(DocumentError, match=r"^\$ 必须是对象"):
        parse_root_tree([])


def test_a_wrong_schema_is_rejected() -> None:
    with pytest.raises(DocumentError, match="schema 必须是"):
        parse_root_tree(_tree(schema="dendro.ui/2"))


def test_a_wrong_version_is_rejected() -> None:
    with pytest.raises(DocumentError, match="version 必须是"):
        parse_root_tree(_tree(version=2))


def test_a_root_that_is_not_a_window_is_rejected() -> None:
    with pytest.raises(DocumentError, match=r"root\.kind 必须是"):
        parse_root_tree(_tree(root_kind="dendro:slot"))


def test_duplicate_ids_are_rejected() -> None:
    with pytest.raises(DocumentError, match="重复 id"):
        parse_root_tree(_tree(page_id="dendro.window.nav"))


def test_a_slot_without_children_is_rejected() -> None:
    broken = deepcopy(_tree())
    del broken["root"]["children"]

    with pytest.raises(DocumentError, match="children 必须是数组"):
        parse_root_tree(broken)


def test_an_anchor_pointing_at_a_missing_id_is_rejected() -> None:
    broken = _tree()
    broken["anchors"]["page"] = "dendro.window.ghost"

    with pytest.raises(DocumentError, match=r"指向不存在的 id: dendro\.window\.ghost"):
        parse_root_tree(broken)


def test_a_missing_required_anchor_is_rejected() -> None:
    broken = _tree()
    del broken["anchors"]["nav"]

    with pytest.raises(DocumentError, match="缺少锚点: nav"):
        parse_root_tree(broken)


def test_the_window_anchor_must_point_at_the_root() -> None:
    broken = _tree()
    broken["anchors"]["window"] = "dendro.window.nav"

    with pytest.raises(DocumentError, match="必须是根 id"):
        parse_root_tree(broken)
