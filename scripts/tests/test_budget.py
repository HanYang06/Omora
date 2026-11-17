"""体量预算：分档判定、边界与合并顺序。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import budget
import pytest


def _root(tmp_path: Path, files: dict[str, str], config: dict[str, Any] | None = None) -> Path:
    for relative, source in files.items():
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source, encoding="utf-8")
    payload = config if config is not None else _config()
    (tmp_path / "budget.json").write_text(json.dumps(payload), encoding="utf-8")
    return tmp_path


def _config(
    *,
    max_lines: int = 1000,
    warn_percent: int | None = 85,
    block_percent: int = 120,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"defaults": {"fileLines": max_lines}}
    if warn_percent is not None:
        payload["tiers"] = {"warnPercent": warn_percent, "blockPercent": block_percent}
    if extra:
        payload.update(extra)
    return payload


def _lines(count: int) -> str:
    return "\n".join(f"line {index}" for index in range(count)) + "\n"


def test_file_at_warning_line_passes_silently(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    root = _root(tmp_path, {"app/edge.py": _lines(850)})

    assert budget.run(root=root, docs=False) == 0

    output = capsys.readouterr().out
    assert "PASS budget.code" in output
    assert "WARN" not in output


def test_file_over_warning_line_warns_without_failing(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    root = _root(tmp_path, {"app/large.py": _lines(851)})

    assert budget.run(root=root, docs=False) == 0

    output = capsys.readouterr().out
    assert "WARN budget.code (1)" in output
    assert "app/large.py: 851 行，超过警告线 850" in output
    assert "FAIL" not in output


def test_file_at_block_line_is_still_tolerated(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    root = _root(tmp_path, {"app/edge.py": _lines(1200)})

    assert budget.run(root=root, docs=False) == 0

    output = capsys.readouterr().out
    assert "WARN budget.code (1)" in output
    assert "FAIL" not in output


def test_file_over_block_line_fails(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    root = _root(tmp_path, {"app/huge.py": _lines(1201)})

    assert budget.run(root=root, docs=False) == 1

    output = capsys.readouterr().out
    assert "FAIL budget.code (1)" in output
    assert "app/huge.py: 1201 行，超过阻断线 1200（上限 1000）" in output


def test_config_without_tiers_uses_default_percentages(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    root = _root(tmp_path, {"app/large.py": _lines(851)}, _config(warn_percent=None))

    assert budget.run(root=root, docs=False) == 0
    assert "WARN budget.code (1)" in capsys.readouterr().out


def test_name_budget_beats_directory_budget(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    config = _config(
        extra={
            "paths": {"app": {"fileLines": 400}},
            "names": {"test_*.py": {"fileLines": 1000}},
        }
    )
    root = _root(tmp_path, {"app/test_deep.py": _lines(500)}, config)

    assert budget.run(root=root, docs=False) == 0
    assert "PASS budget.code" in capsys.readouterr().out


def test_docs_scan_uses_markdown_budget(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    config = _config(extra={"suffixes": {".md": {"fileLines": 500}}})
    root = _root(tmp_path, {"docs/big.md": _lines(601)}, config)

    assert budget.run(root=root, docs=True, code=False) == 1

    output = capsys.readouterr().out
    assert "docs/big.md: 601 行，超过阻断线 600" in output


def test_warn_percent_must_stay_below_block_percent(tmp_path: Path) -> None:
    root = _root(
        tmp_path,
        {},
        {"tiers": {"warnPercent": 120, "blockPercent": 85}, "defaults": {"fileLines": 1000}},
    )

    with pytest.raises(SystemExit, match="warnPercent"):
        budget.run(root=root, docs=False)
