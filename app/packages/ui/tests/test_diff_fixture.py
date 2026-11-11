"""补丁语义的跨语言钉：Python 的 diff 与 TS 的 apply 对同一份 fixture 必须一致。

fixture 在 `app/sdk/tests/fixtures/patch.json`，两边都读它，谁也不自己造样例。
Python 这边钉的是 `diff_snapshot`：同一个 previous / current，产出的 ops 与合并结果都要对得上。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from omora._diff import diff_snapshot

_FIXTURE = (
    Path(__file__).resolve().parents[4] / "app" / "sdk" / "tests" / "fixtures" / "patch.json"
)
_DATA: dict[str, Any] = json.loads(_FIXTURE.read_text(encoding="utf-8"))


def _name(case: dict[str, Any]) -> str:
    return str(case["name"])


@pytest.mark.parametrize("case", _DATA["cases"], ids=_name)
def test_patch_matches_the_shared_fixture(case: dict[str, Any]) -> None:
    result = diff_snapshot(case["previous"], case["current"])
    assert result is not None
    ops, merged = result
    assert ops == case["ops"]
    assert merged == case["merged"]


@pytest.mark.parametrize("case", _DATA["page_changes"], ids=_name)
def test_page_change_has_no_patch(case: dict[str, Any]) -> None:
    assert diff_snapshot(case["previous"], case["current"]) is None
