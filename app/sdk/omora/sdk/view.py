"""主会话视图负载：局部树 + 页面侧表 + 数据文档 + 版本（S6）。

主会话（`ui.render` / `ui.event` / `ui.snapshot`）交的是一份**完整视图**：
局部树交给 TS 链接器在本地链接成权威根树，页面侧表 / 数据文档 / 版本随视图一起给。
Python 不产出整棵根树。

线上形状以 `app/sdk/tests/fixtures/view.json` 为跨语言契约：
顶层 `{kind: 'view', schema, version, localTrees, pages, active, data}`。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from .document import SCHEMA, PageEntry, Register, _non_empty, _require
from .local_tree import LocalTree, serialize_local_trees


def _is_int(value: object) -> bool:
    """int 但不是 bool：bool 是 int 的子类，线上形状不接受它冒充整数。"""
    return isinstance(value, int) and not isinstance(value, bool)


def _validate_pages(pages: Sequence[PageEntry], active: str) -> None:
    """页面侧表与全量文档同一套规则：id 唯一、字段非空、active 必须在 pages 里。"""
    page_ids: set[str] = set()
    for page in pages:
        _require(isinstance(page, PageEntry), "pages 里只能是 PageEntry")
        page_id = _non_empty(page.id, "page.id")
        _require(page_id not in page_ids, f"重复页面 id: {page_id}")
        page_ids.add(page_id)
        _non_empty(page.label, f"{page_id}.label")
        _non_empty(page.route, f"{page_id}.route")
        _non_empty(page.owner, f"{page_id}.owner")
        if page.icon is not None:
            _non_empty(page.icon, f"{page_id}.icon")
    if page_ids:
        _require(active in page_ids, f"active 不在 pages 里: {active!r}")
    else:
        _require(active == "", "没有页面时 active 必须是空串")


def serialize_view(  # noqa: PLR0913 —— 视图信封的声明式参数
    trees: Sequence[LocalTree],
    pages: Sequence[PageEntry],
    active: str,
    data: Mapping[str, Any],
    register: Register,
    *,
    version: int,
    seq: int = 1,
) -> dict[str, Any]:
    """局部树 + 页面侧表 + 数据 → 主会话 view payload。

    version 从 1 单调递增；引擎按全量替换语义应用，旧版本被拒绝。
    """
    _require(_is_int(version) and version >= 1, "view.version 必须是正整数")
    _require(isinstance(data, Mapping), "view.data 必须是对象")
    _validate_pages(pages, active)
    return {
        "kind": "view",
        "schema": SCHEMA,
        "version": version,
        "localTrees": serialize_local_trees(trees, register, seq),
        "pages": [page.to_json() for page in pages],
        "active": active,
        "data": dict(data),
    }


__all__ = ["serialize_view"]
