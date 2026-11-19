"""构建期 V1 树：把插件当前的 Page / Node 升成 `dendro.tree/1` 的 base + partials。

这是迁移桥，不是归宿：插件现在用 `omora.sdk.ui` 的 Node 写页面，V1 接管后插件直接产
V1 节点，本模块随之删除。它只搬形状，不解释业务：

- 窗口骨架在这里生成：`app` 根 + `column` 导航 / `column` 主区 + 每页一个 `column`
  页面容器；
- id 由逻辑 key 经 blake2b 派生（16 位小写十六进制），同一页重建得到同一批 id；
- chain = 父 chain + '.' + id；order 按兄弟下标 ×10（同级唯一且升序）；
- settings 是 Node 字段里「不是 children、不是 callable、不是 None」的那些；传了
  `register` 时，`on_*` callable 换成 handler id 写进 `on`；构建期不传，`on` 为空；
- 每页产出：一份 base document（骨架 + 这一页的容器 + 页面侧表）、导航局部树（每个页面
  一条）、页面内容局部树。

base 里已经含这一页的容器与 `pages` / `active`，所以 `composeTree(base, partials)` 直接
得到这一页的完整文档；不同页的文档各自独立，构建产物按页拆分，不产生一份巨树。
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable, Sequence
from dataclasses import dataclass, fields
from typing import Any

from .ui import Node, Page

SCHEMA = "dendro.tree/1"
FORMAT = "omora.tree.build/1"

ORDER_STEP = 10

ROOT_KEY = "omora.tree/root"
NAV_KEY = "omora.tree/shell/nav"
MAIN_KEY = "omora.tree/shell/main"
PAGE_KEY_PREFIX = "omora.tree/page"
NAV_OWNER = "ui"
NAV_KIND = "page-link"


@dataclass(frozen=True)
class NavEntry:
    """导航里的一条页面入口：构建期只需要名字、标题与图标。"""

    name: str
    title: str
    icon: str | None = None


def tree_id(key: str) -> str:
    """逻辑 key → 稳定节点 id：16 位小写十六进制（schema 的 id 形状）。"""
    if not isinstance(key, str) or key.strip() == "":
        raise ValueError("tree key 必须是非空字符串")
    return hashlib.blake2b(key.encode("utf-8"), digest_size=8).hexdigest()


def _text(value: object, where: str) -> str:
    if not isinstance(value, str) or value.strip() == "":
        raise ValueError(f"{where} 必须是非空字符串")
    return value


def _chain(parent_chain: str, node_id: str) -> str:
    return f"{parent_chain}.{node_id}"


def _kind(node: Node) -> str:
    if not isinstance(node, Node):
        raise TypeError("页面内容必须是 omora.sdk.ui.Node")
    kind = node.type
    if not isinstance(kind, str) or kind.strip() == "":
        raise ValueError("Node.type 必须是非空字符串")
    return kind


def _node_record(  # noqa: PLR0913 —— 节点字段与 schema 一致
    *,
    node_id: str,
    chain: str,
    kind: str,
    order: int,
    layout: list[dict[str, Any]],
    title: str | None = None,
    settings: dict[str, Any] | None = None,
    slot: dict[str, Any] | None = None,
    on: dict[str, str] | None = None,
) -> dict[str, Any]:
    """一个 `dendro.tree/1` 节点；字段与 schema 的 node 一一对应。"""
    record: dict[str, Any] = {
        "id": node_id,
        "chain": chain,
        "kind": kind,
        "order": order,
        "layout": layout,
        "settings": {} if settings is None else settings,
        "bind": {},
        "on": {} if on is None else on,
        "emit": {},
    }
    if title is not None:
        record["title"] = title
    if slot is not None:
        record["slot"] = slot
    return record


Register = Callable[[Callable[[dict[str, Any]], None]], str]


def _ui_node(
    node: Node,
    *,
    parent_chain: str,
    key: str,
    order: int,
    register: Register | None = None,
) -> dict[str, Any]:
    """legacy Node → V1 节点：children 进 layout，on_* 换成 handler id，其余进 settings。"""
    node_id = tree_id(key)
    chain = _chain(parent_chain, node_id)
    settings: dict[str, Any] = {}
    layout: list[dict[str, Any]] = []
    on: dict[str, str] = {}
    for field in fields(node):
        value: Any = getattr(node, field.name)
        if field.name == "children":
            layout = [
                _ui_node(
                    child,
                    parent_chain=chain,
                    key=f"{key}/{index}",
                    order=(index + 1) * ORDER_STEP,
                    register=register,
                )
                for index, child in enumerate(value)
            ]
        elif callable(value):
            if register is not None and field.name.startswith("on_"):
                on[field.name[3:]] = register(value)
            continue
        elif value is not None:
            settings[field.name] = value
    return _node_record(
        node_id=node_id,
        chain=chain,
        kind=_kind(node),
        order=order,
        layout=layout,
        settings=settings,
        on=on,
    )


def _page_id(name: str) -> str:
    return tree_id(f"{PAGE_KEY_PREFIX}/{_text(name, 'page.name')}")


def _page_chain(name: str) -> str:
    return _chain(
        _chain(tree_id(ROOT_KEY), tree_id(MAIN_KEY)),
        _page_id(name),
    )


def base_document(*, name: str, title: str, route: str) -> dict[str, Any]:
    """一页的骨架文档：app 根 + 导航 / 主区 + 这一页的容器；页面侧表只有这一页。"""
    _text(name, "page.name")
    _text(title, "page.title")
    _text(route, "page.route")
    root_id = tree_id(ROOT_KEY)
    nav_id = tree_id(NAV_KEY)
    main_id = tree_id(MAIN_KEY)
    page_id = _page_id(name)
    root_chain = root_id
    nav_chain = _chain(root_chain, nav_id)
    main_chain = _chain(root_chain, main_id)
    page_chain = _chain(main_chain, page_id)
    nav_node = _node_record(
        node_id=nav_id,
        chain=nav_chain,
        kind="column",
        title="nav",
        order=ORDER_STEP,
        layout=[],
    )
    page_node = _node_record(
        node_id=page_id,
        chain=page_chain,
        kind="column",
        title=title,
        order=ORDER_STEP,
        layout=[],
        slot={"size": {"width": "fill"}},
    )
    main_node = _node_record(
        node_id=main_id,
        chain=main_chain,
        kind="column",
        title="main",
        order=ORDER_STEP * 2,
        layout=[page_node],
        slot={"size": {"width": "fill"}},
    )
    root = _node_record(
        node_id=root_id,
        chain=root_chain,
        kind="app",
        title="root",
        order=0,
        layout=[nav_node, main_node],
    )
    return {
        "schema": SCHEMA,
        "version": 1,
        "root": root,
        "pages": [{"id": page_id, "title": title, "route": route}],
        "active": page_id,
        "data": {},
    }


def nav_partials(entries: Sequence[NavEntry], *, active: str) -> list[dict[str, Any]]:
    """导航局部树：每个页面一条，挂进骨架的导航容器；active 标当前页。"""
    _text(active, "nav.active")
    nav_id = tree_id(NAV_KEY)
    nav_chain = _chain(tree_id(ROOT_KEY), nav_id)
    partials: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, entry in enumerate(entries):
        name = _text(entry.name, "nav.name")
        if name in seen:
            raise ValueError(f"重复导航页面: {name}")
        seen.add(name)
        node_id = tree_id(f"omora.tree/nav/{name}")
        settings: dict[str, Any] = {
            "label": _text(entry.title, f"nav.{name}.title"),
            "route": f"/{name}",
            "active": name == active,
        }
        if entry.icon is not None:
            settings["icon"] = _text(entry.icon, f"nav.{name}.icon")
        partials.append(
            {
                "schema": SCHEMA,
                "source": NAV_OWNER,
                "mount": {"parent": nav_id, "mode": "new"},
                "root": _node_record(
                    node_id=node_id,
                    chain=_chain(nav_chain, node_id),
                    kind=NAV_KIND,
                    title=entry.title,
                    order=(index + 1) * ORDER_STEP,
                    layout=[],
                    settings=settings,
                ),
            }
        )
    return partials


def content_partial(
    page: Page,
    *,
    name: str,
    owner: str,
    register: Register | None = None,
) -> dict[str, Any]:
    """页面内容局部树：挂在 base 的页面容器里。"""
    if not isinstance(page, Page):
        raise TypeError("page 必须是 omora.sdk.ui.Page")
    _text(owner, "page.owner")
    page_id = _page_id(name)
    root = _ui_node(
        page.content,
        parent_chain=_page_chain(name),
        key=f"{PAGE_KEY_PREFIX}/{name}/content",
        order=ORDER_STEP,
        register=register,
    )
    return {
        "schema": SCHEMA,
        "source": owner,
        "mount": {"parent": page_id, "mode": "new"},
        "root": root,
    }


def build_page(  # noqa: PLR0913 —— 一页的构建输入
    *,
    name: str,
    title: str,
    route: str,
    page: Page,
    owner: str,
    nav: Sequence[NavEntry],
    register: Register | None = None,
) -> dict[str, Any]:
    """一页的构建输入：base + 局部树（导航 + 内容）。"""
    return {
        "name": _text(name, "page.name"),
        "title": _text(title, "page.title"),
        "route": _text(route, "page.route"),
        "base": base_document(name=name, title=title, route=route),
        "partials": [
            *nav_partials(nav, active=name),
            content_partial(page, name=name, owner=owner, register=register),
        ],
    }


__all__ = [
    "FORMAT",
    "NAV_KIND",
    "ORDER_STEP",
    "SCHEMA",
    "NavEntry",
    "base_document",
    "build_page",
    "content_partial",
    "nav_partials",
    "tree_id",
]
