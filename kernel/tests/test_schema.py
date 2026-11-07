"""协议目录定位与 schema 读取的行为。"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from omora_kernel.schema import PROTOCOL_DIR_ENV, load_schema, protocol_dir

ROOT = Path(__file__).resolve().parents[2]


def test_protocol_dir_honors_environment_override(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(PROTOCOL_DIR_ENV, str(tmp_path))

    assert protocol_dir() == tmp_path


def test_protocol_dir_finds_repository_protocol_directory(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(PROTOCOL_DIR_ENV, raising=False)

    assert protocol_dir() == ROOT / "protocol"


def test_load_schema_reads_named_schema_from_protocol_dir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(PROTOCOL_DIR_ENV, str(tmp_path))
    (tmp_path / "demo.schema.json").write_text(json.dumps({"title": "Demo"}), encoding="utf-8")

    assert load_schema("demo.schema.json") == {"title": "Demo"}


def test_load_schema_reports_missing_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(PROTOCOL_DIR_ENV, str(tmp_path))

    try:
        load_schema("missing.schema.json")
    except FileNotFoundError as error:
        assert "missing.schema.json" in str(error)
        return
    raise AssertionError("缺失的 schema 应抛出 FileNotFoundError")
