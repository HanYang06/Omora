"""契约测试:protocol/ 下的 schema 是唯一真相。

每个 schema 都必须有 fixtures 样本,合法样本必须通过校验,非法样本必须被拒绝。
新增 schema 而不加样本,这里直接失败——契约不允许"跑一遍看看"。
"""

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import jsonschema
import pytest
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[3]
PROTOCOL = ROOT / "protocol"
FIXTURES = PROTOCOL / "fixtures"

FIXTURE = re.compile(
    r"^(?P<base>[a-z0-9-]+)\.(?P<kind>valid|invalid)(?:-(?P<slug>[a-z0-9-]+))?\.json$"
)


@dataclass(frozen=True)
class Case:
    schema: Path
    fixture: Path
    expect_valid: bool


def _load(path: Path) -> dict[str, Any]:
    return cast("dict[str, Any]", json.loads(path.read_text(encoding="utf-8")))


def _cases() -> list[Case]:
    cases: list[Case] = []
    for path in sorted(FIXTURES.glob("*.json")):
        matched = FIXTURE.match(path.name)
        assert matched is not None, f"fixture 命名不合约定: {path.name}"
        schema = PROTOCOL / f"{matched.group('base')}.schema.json"
        assert schema.is_file(), f"缺少对应 schema: {schema.name}"
        cases.append(
            Case(schema=schema, fixture=path, expect_valid=matched.group("kind") == "valid")
        )
    assert cases, "protocol/fixtures 下没有任何样本"
    return cases


CASES = _cases()


@pytest.mark.parametrize("case", CASES, ids=[c.fixture.name for c in CASES])
def test_fixture_matches_schema(case: Case) -> None:
    schema = _load(case.schema)
    instance = _load(case.fixture)
    if case.expect_valid:
        jsonschema.validate(instance=instance, schema=schema)
    else:
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=instance, schema=schema)


@pytest.mark.parametrize("schema", sorted(PROTOCOL.glob("*.schema.json")), ids=lambda p: p.name)
def test_schema_is_a_valid_json_schema(schema: Path) -> None:
    Draft202012Validator.check_schema(_load(schema))


@pytest.mark.parametrize("schema", sorted(PROTOCOL.glob("*.schema.json")), ids=lambda p: p.name)
def test_schema_has_at_least_one_fixture(schema: Path) -> None:
    assert any(c.schema == schema for c in CASES), f"{schema.name} 没有对应的 fixtures 样本"


def test_unknown_key_is_rejected_everywhere() -> None:
    node = {"type": "Text", "props": {"text": "x"}, "style": {}}
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(instance=node, schema=_load(PROTOCOL / "c3-node.schema.json"))
