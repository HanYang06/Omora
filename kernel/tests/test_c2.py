"""C2 清单校验与引擎范围的行为。"""

from __future__ import annotations

import pytest
from omora_kernel.contract.c2 import (
    EngineIncompatibleError,
    InvalidManifestError,
    semver_satisfies,
    validate_manifest,
)


def manifest_data(**overrides: object) -> dict[str, object]:
    data: dict[str, object] = {
        "id": "test.note",
        "name": "Note",
        "version": "0.1.0",
        "engines": {"omora": "^0.1.0"},
        "runtime": "python",
        "entry": "note_plugin:plugin",
        "activation": ["onStartup"],
        "capabilities": ["commands", "events", "ui"],
        "contributes": {
            "commands": [{"id": "note.create", "title": "Create"}],
            "slots": [{"id": "note.panel", "slot": "sidebar", "order": 1}],
        },
    }
    data.update(overrides)
    return data


@pytest.mark.parametrize(
    ("version", "constraint", "expected"),
    [
        ("0.1.0", "^0.1.0", True),
        ("0.1.9", "^0.1.0", True),
        ("0.2.0", "^0.1.0", False),
        ("0.2.3", "^0.2.3", True),
        ("0.3.0", "^0.2.3", False),
        ("0.0.3", "^0.0.3", True),
        ("0.0.4", "^0.0.3", False),
        ("1.9.9", "^1.2.3", True),
        ("2.0.0", "^1.2.3", False),
        ("0.1.9", "~0.1.0", True),
        ("0.2.0", "~0.1.0", False),
        ("1.2.9", "~1.2.3", True),
        ("1.3.0", "~1.2.3", False),
        ("0.1.0", ">=0.1.0", True),
        ("0.0.9", ">=0.1.0", False),
        ("0.1.1", ">0.1.0", True),
        ("0.1.0", ">0.1.0", False),
        ("0.1.0", "<=0.1.0", True),
        ("0.1.1", "<=0.1.0", False),
        ("0.1.9", "<0.2.0", True),
        ("0.2.0", "<0.2.0", False),
        ("0.1.0", "=0.1.0", True),
        ("0.1.1", "=0.1.0", False),
        ("0.1.0", "0.1.0", True),
        ("0.1.1", "0.1.0", False),
        ("0.9.9", "*", True),
        ("0.1.5", ">=0.1.0 <0.2.0", True),
        ("0.2.0", ">=0.1.0 <0.2.0", False),
    ],
)
def test_semver_satisfies_range_forms(version: str, constraint: str, expected: bool) -> None:
    assert semver_satisfies(version, constraint) is expected


@pytest.mark.parametrize("constraint", ["", "1.2", "nonsense"])
def test_semver_rejects_unparseable_range(constraint: str) -> None:
    try:
        semver_satisfies("0.1.0", constraint)
    except ValueError:
        return
    raise AssertionError(f"无法解析的范围应抛出 ValueError: {constraint!r}")


def test_semver_rejects_unparseable_version() -> None:
    try:
        semver_satisfies("0.1", "^0.1.0")
    except ValueError:
        return
    raise AssertionError("非法版本应抛出 ValueError")


def test_validate_manifest_returns_sdk_view_for_valid_manifest() -> None:
    manifest = validate_manifest(manifest_data())

    assert manifest.id == "test.note"
    assert manifest.capabilities == frozenset({"commands", "events", "ui"})
    assert manifest.activation == ("onStartup",)
    assert manifest.contributes["slots"] == [{"id": "note.panel", "slot": "sidebar", "order": 1}]


def test_validate_manifest_rejects_unknown_capability() -> None:
    data = manifest_data(capabilities=["commands", "teleport"])

    try:
        validate_manifest(data)
    except InvalidManifestError as error:
        assert error.code == "E_INVALID"
        return
    raise AssertionError("非法能力应被拒绝")


def test_validate_manifest_rejects_unknown_field() -> None:
    data = manifest_data(extra="nope")

    try:
        validate_manifest(data)
    except InvalidManifestError:
        return
    raise AssertionError("未知字段应被拒绝")


def test_validate_manifest_reports_engine_incompatibility_separately() -> None:
    data = manifest_data(engines={"omora": "^0.2.0"})

    try:
        validate_manifest(data)
    except EngineIncompatibleError as error:
        assert error.code == "E_UNAVAILABLE"
        return
    raise AssertionError("引擎不兼容应抛出 EngineIncompatibleError")


def test_validate_manifest_rejects_unparseable_engine_range() -> None:
    data = manifest_data(engines={"omora": "0.1"})

    try:
        validate_manifest(data)
    except InvalidManifestError:
        return
    raise AssertionError("无法解析的引擎范围应算清单不合法")
