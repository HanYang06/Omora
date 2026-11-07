"""C3 节点校验与降级：schema 是唯一真相，降级是显式的。

- validate_node 直接用 protocol/c3-node.schema.json 校验整棵节点树（Draft 2020-12），
  非法时抛 NodeValidationError；
- degrade_node 不是校验：它把渲染器不认识的 type 换成 Text + caption 占位节点，
  任何输入都不抛错。

两件事不混在一起：校验不偷偷放行未知类型，降级也不假装自己校验过。KNOWN_TYPES 是
渲染器词表（渲染器认识哪些 type），不是 schema 的副本。
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Protocol, cast

from jsonschema import Draft202012Validator, exceptions
from jsonschema.exceptions import ValidationError
from omora_kernel.schema import load_schema

KNOWN_TYPES = frozenset({"Stack", "Text", "Button", "Input", "List", "Card"})
CONTAINER_TYPES = frozenset({"Stack", "List", "Card"})
EVENT_TYPES = frozenset({"Button", "Input"})
PLACEHOLDER_TEXT = "未知节点类型: {}"


class _Validator(Protocol):
    def iter_errors(self, instance: object) -> Iterable[ValidationError]: ...


class _Errors(Protocol):
    def best_match(self, errors: Iterable[ValidationError]) -> ValidationError | None: ...


_SCHEMA_VALIDATOR: _Validator = cast(
    "_Validator", Draft202012Validator(load_schema("c3-node.schema.json"))
)
_ERRORS: _Errors = cast("_Errors", exceptions)


class NodeValidationError(ValueError):
    """C3 节点不符合 schema；语义对应错误码 E_INVALID。"""

    code: str = "E_INVALID"

    def __init__(self, message: str, path: str) -> None:
        self.path = path
        super().__init__(f"{path}: {message}")


def validate_node(node: object) -> None:
    """按 C3 schema 校验以 node 为根的整棵树；失败抛 NodeValidationError。"""
    errors = list(_SCHEMA_VALIDATOR.iter_errors(node))
    if not errors:
        return
    error = _ERRORS.best_match(errors)
    if error is not None:
        raise NodeValidationError(error.message, error.json_path)


def degrade_node(node: object) -> dict[str, object]:
    """把未知 type 或无法识别的节点换成 Text + caption 占位节点；任何输入都不抛错。"""
    if not isinstance(node, Mapping):
        return _placeholder(None)
    entries = cast("Mapping[str, object]", node)
    node_type = entries.get("type")
    if not isinstance(node_type, str) or node_type not in KNOWN_TYPES:
        return _placeholder(node_type)
    result: dict[str, object] = {"type": node_type, "props": entries.get("props", {})}
    if node_type in CONTAINER_TYPES and isinstance(entries.get("children"), list):
        children = cast("list[object]", entries["children"])
        result["children"] = [degrade_node(child) for child in children]
    if node_type in EVENT_TYPES and "on" in entries:
        result["on"] = entries["on"]
    return result


def _placeholder(node_type: object) -> dict[str, object]:
    label = node_type if isinstance(node_type, str) else "未知"
    return {"type": "Text", "props": {"text": PLACEHOLDER_TEXT.format(label), "variant": "caption"}}
