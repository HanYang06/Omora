"""复杂度计量的行为：只在 measuring() 内计数、阶段分开、嵌套互不影响。"""

from __future__ import annotations

from typing import Any

import pytest

from omora.sdk.tree_build import build_page, compose
from omora.sdk.tree_diff import diff_documents, needs_full
from omora.sdk.tree_meter import bump, measuring
from omora.sdk.ui import Column, Page, Text


def _built(count: int) -> dict[str, Any]:
    page = Page(content=Column(*[Text(text=f"item-{index}") for index in range(count)]))
    return build_page(name="feed", title="流", route="/feed", page=page, owner="ideas", nav=[])


def _count(node: dict[str, Any]) -> int:
    return 1 + sum(_count(child) for child in node["layout"])


def test_bump_without_measuring_is_a_no_op() -> None:
    """产线默认零开销：不开计量时 bump 不抛错、不改变任何结果。"""
    bump("build")

    document = compose(**_parts(_built(2)))

    assert document["schema"] == "dendro.tree/1"


def _parts(built: dict[str, Any]) -> dict[str, Any]:
    return {"base": built["base"], "partials": built["partials"]}


def test_build_count_equals_composed_node_count() -> None:
    """每个文档节点恰好构建一次；计数器和文档结构对得上才可信。"""
    with measuring() as meter:
        built = _built(3)
        document = compose(**_parts(built))

    assert meter.counts["build"] == _count(document["root"])
    assert meter.counts["compose"] == 2 * _count(document["root"])


def test_diff_walk_count_matches_traversed_nodes() -> None:
    """差分前要遍历整份文档：needs_full 与 diff 各两遍。"""
    document = compose(**_parts(_built(2)))
    nodes = _count(document["root"])

    with measuring() as meter:
        needs_full(document, document)
        diff_documents(document, document)

    assert meter.counts["walk"] == 4 * nodes
    assert meter.total == sum(meter.counts.values())


def test_nested_measuring_stays_out_of_the_outer_meter() -> None:
    """嵌套计量各自独立：外层不该把内层的节点算进来。"""
    with measuring() as single:
        _built(1)
    with measuring() as outer:
        _built(1)
        with measuring() as inner:
            _built(1)
        bump("build")

    assert inner.total == single.total
    assert outer.total == single.total + 1


def test_unknown_stage_is_rejected() -> None:
    """阶段名写错要当场报错，不要静默记到别处。"""
    with measuring() as meter, pytest.raises(ValueError, match="未知阶段"):
        meter.bump("buidl")
