"""tree.py 的行为测试：示例能过，形状与结构错误按稳定码失败。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, cast

import pytest

from omora.sdk.tree import (
    TreeError,
    load_document,
    load_node,
    load_partial,
    parse_document,
    parse_node,
    parse_partial,
)

ROOT = Path(__file__).resolve().parents[3]
TREE = ROOT / "schema" / "tree"
EXAMPLES = TREE / "example"
INVALID = TREE / "invalid"

MANIFEST: list[dict[str, str]] = cast(
    list[dict[str, str]],
    json.loads((INVALID / "manifest.json").read_text(encoding="utf-8")),
)
PARSERS = {"document": parse_document, "partial": parse_partial, "node": parse_node}


def raw(path: Path) -> dict[str, Any]:
    return cast(dict[str, Any], json.loads(path.read_text(encoding="utf-8")))


def document() -> dict[str, Any]:
    return raw(EXAMPLES / "tree.root.json")


def partial() -> dict[str, Any]:
    return raw(EXAMPLES / "tree.partial.json")


def nav(data: dict[str, Any]) -> dict[str, Any]:
    return cast(dict[str, Any], data["root"]["layout"][0])


def nav_items(data: dict[str, Any]) -> list[dict[str, Any]]:
    return cast(list[dict[str, Any]], nav(data)["layout"])


def code_of_document(data: dict[str, Any]) -> str:
    with pytest.raises(TreeError) as exc:
        parse_document(data)
    return exc.value.code


def test_examples_load() -> None:
    doc = load_document(EXAMPLES / "tree.root.json")
    assert doc.schema == "dendro.tree/1"
    assert doc.root.kind == "app"
    assert doc.root.id == "a1b2c3d4e5f6a7b8"
    assert doc.active == "4b5c6d7e8f9a0b1c"
    assert doc.pages[0].id == doc.active
    assert doc.ledger[doc.active].source == "ideas"
    assert doc.root.layout[0].layout[0].id == "1c2d3e4f5a6b7c8d"

    part = load_partial(EXAMPLES / "tree.partial.json")
    assert part.source == "ideas"
    assert part.mount.parent == "3a4b5c6d7e8f9a0b"
    assert part.mount.mode == "new"
    assert part.root.id == doc.active

    node = load_node(EXAMPLES / "tree.node.json")
    assert node.kind == "button"
    assert node.chain.endswith("." + node.id)
    assert node.layout == ()


@pytest.mark.parametrize("field", ["settings", "bind", "on", "emit"])
def test_non_nesting_fields_cannot_hide_a_node(field: str) -> None:
    data = document()
    nav_items(data)[0][field]["nested"] = {
        "id": "ffffffffffffffff",
        "chain": "ffffffffffffffff",
        "kind": "button",
        "layout": [],
    }
    assert code_of_document(data) == "E-TREE-NEST"


def test_duplicate_id_fails() -> None:
    data = document()
    first, second = nav_items(data)
    second["id"] = first["id"]
    second["chain"] = first["chain"]
    assert code_of_document(data) == "E-TREE-DUP-ID"


def test_chain_must_end_with_id() -> None:
    data = document()
    item = nav_items(data)[0]
    item["chain"] = item["chain"].rsplit(".", 1)[0] + ".ffffffffffffffff"
    assert code_of_document(data) == "E-TREE-CHAIN"


def test_duplicate_order_fails() -> None:
    data = document()
    first, second = nav_items(data)
    second["order"] = first["order"]
    assert code_of_document(data) == "E-TREE-ORDER"


def test_layout_must_be_sorted() -> None:
    data = document()
    first, second = nav_items(data)
    first["order"] = 20
    second["order"] = 10
    assert code_of_document(data) == "E-TREE-ORDER"


def test_active_must_point_to_a_page() -> None:
    data = document()
    data["active"] = "ffffffffffffffff"
    assert code_of_document(data) == "E-TREE-PAGE"


def test_page_must_be_in_the_tree() -> None:
    data = document()
    data["pages"][0]["id"] = "eeeeeeeeeeeeeeee"
    assert code_of_document(data) == "E-TREE-PAGE"


def test_missing_layout_fails() -> None:
    node = raw(EXAMPLES / "tree.node.json")
    del node["layout"]
    with pytest.raises(TreeError) as exc:
        parse_node(node)
    assert exc.value.code == "E-TREE-PAYLOAD"


def test_unknown_field_fails() -> None:
    node = raw(EXAMPLES / "tree.node.json")
    node["extra"] = True
    with pytest.raises(TreeError) as exc:
        parse_node(node)
    assert exc.value.code == "E-TREE-PAYLOAD"


def test_partial_mode_must_be_known() -> None:
    data = partial()
    data["mount"]["mode"] = "sideways"
    with pytest.raises(TreeError) as exc:
        parse_partial(data)
    assert exc.value.code == "E-TREE-MOUNT"


def test_standalone_node_chain_can_start_mid_tree() -> None:
    node = load_node(EXAMPLES / "tree.node.json")
    assert node.chain == "a1b2c3d4e5f6a7b8.0a1b2c3d4e5f6a7b.1c2d3e4f5a6b7c8d"


def test_parse_node_root_chain_requires_chain_to_equal_id() -> None:
    node = raw(EXAMPLES / "tree.node.json")
    with pytest.raises(TreeError) as exc:
        parse_node(node, root_chain=True)
    assert exc.value.code == "E-TREE-CHAIN"


@pytest.mark.parametrize("case", MANIFEST, ids=[case["file"] for case in MANIFEST])
def test_invalid_fixtures_fail_with_the_declared_code(case: dict[str, str]) -> None:
    data = raw(INVALID / case["file"])
    with pytest.raises(TreeError) as exc:
        PARSERS[case["type"]](data)
    assert exc.value.code == case["code"], f"{case['file']} ({case['scope']})"


def test_id_shape_errors_name_the_concrete_field_path() -> None:
    data = document()
    nav_items(data)[0]["id"] = "not-hex"
    with pytest.raises(TreeError) as exc:
        parse_document(data)
    assert exc.value.code == "E-TREE-ID"
    assert exc.value.path == "$.root.layout[0].layout[0].id"


def test_chain_shape_errors_name_the_concrete_field_path() -> None:
    data = document()
    nav_items(data)[0]["chain"] = "not-a-chain"
    with pytest.raises(TreeError) as exc:
        parse_document(data)
    assert exc.value.code == "E-TREE-CHAIN"
    assert exc.value.path == "$.root.layout[0].layout[0].chain"


def test_root_kind_must_be_app() -> None:
    data = document()
    data["root"]["kind"] = "window"
    with pytest.raises(TreeError) as exc:
        parse_document(data)
    assert exc.value.code == "E-TREE-ROOT"
    assert exc.value.path == "$.root.kind"


def test_unknown_schema_maps_to_payload() -> None:
    data = document()
    data["schema"] = "dendro.tree/2"
    with pytest.raises(TreeError) as exc:
        parse_document(data)
    assert exc.value.code == "E-TREE-PAYLOAD"
    assert exc.value.path == "$.schema"


def test_shape_errors_are_reported_in_path_order() -> None:
    data = document()
    items = nav_items(data)
    items[0]["id"] = "not-hex"
    items[1]["order"] = -1
    assert code_of_document(data) == "E-TREE-ID"


def test_ledger_key_must_be_a_node_id() -> None:
    data = document()
    data["ledger"]["ffffffffffffffff"] = {"source": "ghost"}
    with pytest.raises(TreeError) as exc:
        parse_document(data)
    assert exc.value.code == "E-TREE-LEDGER"
    assert exc.value.path == "$.ledger.ffffffffffffffff"


def test_ledger_defaults_to_empty() -> None:
    data = document()
    del data["ledger"]
    doc = parse_document(data)
    assert doc.ledger == {}


def test_empty_pages_allow_empty_active() -> None:
    data = document()
    data["pages"] = []
    data["active"] = ""
    doc = parse_document(data)
    assert doc.pages == ()
    assert doc.active == ""


def test_empty_pages_reject_non_empty_active() -> None:
    data = document()
    data["pages"] = []
    data["active"] = "4b5c6d7e8f9a0b1c"
    with pytest.raises(TreeError) as exc:
        parse_document(data)
    assert exc.value.code == "E-TREE-PAGE"
    assert exc.value.path == "$.active"
