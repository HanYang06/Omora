"""契约测试：C3 节点 schema 必须能校验黄金样本。"""

import json
from pathlib import Path
from typing import Any, cast

import jsonschema

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = ROOT / "protocol" / "c3-node.schema.json"
FIXTURE = ROOT / "protocol" / "fixtures" / "c3-node.valid.json"


def _load(path: Path) -> dict[str, Any]:
    return cast("dict[str, Any]", json.loads(path.read_text(encoding="utf-8")))


def test_valid_fixture_passes() -> None:
    jsonschema.validate(instance=_load(FIXTURE), schema=_load(SCHEMA))


def test_missing_type_is_rejected() -> None:
    try:
        jsonschema.validate(instance={"props": {}}, schema=_load(SCHEMA))
    except jsonschema.ValidationError:
        return
    raise AssertionError("缺少 type 的节点应被拒绝")


def test_unknown_top_level_key_is_rejected() -> None:
    try:
        jsonschema.validate(instance={"type": "Text", "hack": 1}, schema=_load(SCHEMA))
    except jsonschema.ValidationError:
        return
    raise AssertionError("未知顶层字段应被拒绝")
