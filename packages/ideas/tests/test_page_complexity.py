"""灵感页的节点数不随条目数增长：列表是数据，不是页面节点。

这是 #160 / ADR-0005 的验收：50 条和 500 条灵感，页面树一样大、重交一次树的
处理量一样多。列表条目走 collection + data op，不参与页面构造。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from omora.core.kernel import Kernel
from omora.ideas import IdeasPlugin
from omora.media import MediaPlugin
from omora.sdk.tree_meter import measuring
from omora.store import StorePlugin
from omora.ui import UiPlugin

FIELDS = {"title": "text", "archived": "bool", "pinned": "bool", "media": "text?"}


def _kernel(tmp_path: Path) -> Kernel:
    kernel = Kernel()
    kernel.install(StorePlugin(path=str(tmp_path / "omora.db")))
    kernel.install(MediaPlugin(root=str(tmp_path / "media")))
    kernel.install(UiPlugin())
    kernel.install(IdeasPlugin())
    return kernel


def _fill(kernel: Kernel, count: int) -> None:
    store: Any = kernel.resolve("store")
    ideas = store.collection(
        "ideas", fields=FIELDS, indexes=["archived"], searchable=["title"], pinned="pinned"
    )
    for index in range(count):
        ideas.add(title=f"灵感 {index}", archived=False, pinned=False, media=None)


def _mounted_nodes(node: dict[str, Any]) -> int:
    return 1 + sum(_mounted_nodes(child) for child in node["layout"])


def _measure(tmp_path: Path, count: int) -> tuple[int, int]:
    kernel = _kernel(tmp_path)
    _fill(kernel, count)
    ui = kernel.resolve("ui")
    ui.tree()
    document = ui.current_document
    assert document is not None
    nodes = _mounted_nodes(document["root"])
    with measuring() as meter:
        ui.tree()
    return nodes, meter.total


def test_the_page_tree_is_the_same_size_with_more_ideas(tmp_path: Path) -> None:
    small, _ = _measure(tmp_path / "small", 50)
    large, _ = _measure(tmp_path / "large", 500)

    assert small == large
    assert small < 120


def test_rebuilding_the_page_does_not_scale_with_the_idea_count(tmp_path: Path) -> None:
    _, small = _measure(tmp_path / "small", 50)
    _, large = _measure(tmp_path / "large", 500)

    assert large <= small + 8
