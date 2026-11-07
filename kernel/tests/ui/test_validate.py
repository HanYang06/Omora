"""C3 节点校验与降级：schema 驱动的严格校验、显式降级、两件事分开。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Protocol, cast

import pytest
from jsonschema import Draft202012Validator
from omora_kernel.ui.validate import NodeValidationError, degrade_node, validate_node


class _SchemaChecker(Protocol):
    def is_valid(self, instance: object) -> bool: ...


ROOT = Path(__file__).resolve().parents[3]
FIXTURES = ROOT / "protocol" / "fixtures"
SCHEMA_PATH = ROOT / "protocol" / "c3-node.schema.json"


def _fixture(name: str) -> dict[str, Any]:
    return cast("dict[str, Any]", json.loads((FIXTURES / name).read_text(encoding="utf-8")))


def _schema_accepts(node: object) -> bool:
    schema = cast("dict[str, Any]", json.loads(SCHEMA_PATH.read_text(encoding="utf-8")))
    checker = cast("_SchemaChecker", Draft202012Validator(schema))
    return checker.is_valid(node)


def _validator_accepts(node: object) -> bool:
    try:
        validate_node(node)
    except NodeValidationError:
        return False
    return True


def test_valid_fixture_passes_validation() -> None:
    validate_node(_fixture("c3-node.valid.json"))


def test_unknown_type_is_rejected_by_validation() -> None:
    with pytest.raises(NodeValidationError) as info:
        validate_node({"type": "Marquee", "props": {}})
    assert info.value.code == "E_INVALID"
    assert info.value.path == "$"


def test_extra_top_level_key_is_rejected() -> None:
    with pytest.raises(NodeValidationError) as info:
        validate_node(_fixture("c3-node.invalid-extra-key.json"))
    assert info.value.code == "E_INVALID"
    assert info.value.path == "$"


def test_nested_invalid_node_is_rejected() -> None:
    tree: dict[str, object] = {
        "type": "Stack",
        "props": {},
        "children": [{"type": "Text", "props": {}}],
    }
    with pytest.raises(NodeValidationError) as info:
        validate_node(tree)
    assert info.value.code == "E_INVALID"


def test_invalid_command_ref_is_rejected() -> None:
    tree: dict[str, object] = {
        "type": "Button",
        "props": {"label": "保存"},
        "on": {"click": {}},
    }
    with pytest.raises(NodeValidationError) as info:
        validate_node(tree)
    assert info.value.path == "$.on.click"


CALIBRATION: list[tuple[str, object, bool]] = [
    ("valid-fixture", _fixture("c3-node.valid.json"), True),
    ("invalid-fixture", _fixture("c3-node.invalid.json"), False),
    ("extra-key-fixture", _fixture("c3-node.invalid-extra-key.json"), False),
    (
        "nested-invalid",
        {"type": "Stack", "props": {}, "children": [{"type": "Text", "props": {}}]},
        False,
    ),
]


@pytest.mark.parametrize(
    ("name", "node", "expected"), CALIBRATION, ids=[case[0] for case in CALIBRATION]
)
def test_validation_agrees_with_protocol_schema(name: str, node: object, expected: bool) -> None:
    assert _schema_accepts(node) is expected, name
    assert _validator_accepts(node) is expected, name


def test_degrade_replaces_unknown_type_with_caption_placeholder() -> None:
    degraded = degrade_node({"type": "Marquee", "props": {"text": "x"}, "children": []})
    assert degraded == {
        "type": "Text",
        "props": {"text": "未知节点类型: Marquee", "variant": "caption"},
    }


def test_degraded_tree_passes_validation() -> None:
    tree: dict[str, object] = {
        "type": "Stack",
        "props": {"direction": "vertical"},
        "children": [
            {"type": "Marquee", "props": {}},
            {"type": "Text", "props": {"text": "仍然可见"}},
        ],
    }
    degraded = degrade_node(tree)
    validate_node(degraded)
    children = cast("list[object]", degraded["children"])
    assert children[0] == {
        "type": "Text",
        "props": {"text": "未知节点类型: Marquee", "variant": "caption"},
    }


def test_degrade_preserves_known_tree() -> None:
    tree = _fixture("c3-node.valid.json")
    assert degrade_node(tree) == tree


@pytest.mark.parametrize("node", [None, 42, {"props": {}}, {"type": 7}, {"type": "Marquee"}])
def test_degrade_never_raises_for_malformed_nodes(node: object) -> None:
    degraded = degrade_node(node)
    validate_node(degraded)
    assert degraded["type"] == "Text"
