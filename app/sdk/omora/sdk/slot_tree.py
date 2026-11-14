"""legacy Node / Page 树 → Slot 局部树（S6.2）。

主会话切到 Slot 视图后，插件还按 `omora.sdk.ui` 的 Node / Page 写页面；本模块只做
形状搬运，把 legacy 树升成 Slot 信封：

- kind = `dendro:<type>`（已经带命名空间的原样保留）；
- 非 callable、非 children 的字段进 props，None 省略；
- callable 字段进 events，事件名去掉 `on_` 前缀，值经 `register` 换成 handler id；
- id 是确定性的（`page.<name>.content.<index path>`），同一棵树重建得到同一批 id；
- 页面根是 flow=column / capacity=many 的 `dendro:page`，children 就是页面内容
  （旧壳不画标题 / meta，这里也不额外加，保持两条路径渲染等价）。

nav 与 page 两棵局部树用不同前缀（`ui.nav.*` / `page.*`），跨树 id 不会撞。
本模块不产出整棵根树：把局部树链接成权威文档在 TS 侧。
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, fields
from typing import Any

from .document import (
    Handler,
    JsonObject,
    Layout,
    Register,
    Slot,
    _non_empty,
    _require,
)
from .local_tree import LocalTree
from .ui import Node, Page

NAMESPACE = "dendro"
PAGE_KIND = "dendro:page"
PAGE_MOUNT_AT = "dendro.window.page"
NAV_KIND = "dendro:slot"
NAV_MOUNT_AT = "dendro.window.nav"
NAV_OWNER = "ui"
NAV_ROOT_ID = "ui.nav"
EVENT_PREFIX = "on_"


@dataclass(frozen=True)
class NavLink:
    """导航里的一条页面入口：去哪个页、显示什么、点了干什么、是不是当前页。"""

    page: str
    label: str
    icon: str | None
    on_click: Handler
    active: bool = False

    def __post_init__(self) -> None:
        _non_empty(self.page, "nav.page")
        _non_empty(self.label, "nav.label")
        if self.icon is not None:
            _non_empty(self.icon, "nav.icon")
        _require(callable(self.on_click), "nav.on_click 必须是可调用对象")
        _require(isinstance(self.active, bool), "nav.active 必须是 bool")


def page_id(page_name: str) -> str:
    """页面根 / 页面侧表共用的确定性 id。"""
    return f"page.{_non_empty(page_name, 'page.name')}"


def event_name(field_name: str) -> str:
    """callable 字段名 → 事件名：`on_click` → `click`，没有前缀就原样。"""
    if field_name.startswith(EVENT_PREFIX) and len(field_name) > len(EVENT_PREFIX):
        return field_name[len(EVENT_PREFIX) :]
    return field_name


def kind_of(node: Node) -> str:
    """legacy 节点类型 → Slot kind：没有命名空间的补 `dendro:`。"""
    kind = node.type
    _require(isinstance(kind, str) and kind.strip() != "", "Node.type 必须是非空字符串")
    return kind if ":" in kind else f"{NAMESPACE}:{kind}"


def serialize_node_slot(
    node: Node,
    register: Register,
    *,
    owner: str,
    node_id: str,
) -> Slot:
    """legacy Node → Slot：children 递归，callable 进 events，其余进 props。"""
    _require(isinstance(node, Node), "页面内容必须是 Node")
    _non_empty(owner, "slot.owner")
    _non_empty(node_id, "slot.id")
    props: JsonObject = {}
    events: dict[str, Handler] = {}
    children: list[Slot] = []

    for field in fields(node):
        value: Any = getattr(node, field.name)
        if field.name == "children":
            children = [
                serialize_node_slot(
                    child,
                    register,
                    owner=owner,
                    node_id=f"{node_id}.{index}",
                )
                for index, child in enumerate(value)
            ]
        elif callable(value):
            events[event_name(field.name)] = value
        elif value is not None:
            props[field.name] = value

    return Slot(
        node_id,
        kind_of(node),
        owner=owner,
        props=props,
        events=events,
        children=children,
    )


def serialize_page_slot(  # noqa: PLR0913 —— 页面根的声明式参数
    page: Page,
    register: Register,
    *,
    owner: str,
    page_name: str,
    label: str,
    icon: str | None = None,
) -> LocalTree:
    """一页 legacy Page → 挂在 dendro.window.page 上的局部树。

    页面根 id 是 `page.<page_name>`，owner 是页面注册者；children 是
    [header, content 转换结果]。label / icon 进根 props（页面侧表同源）。
    """
    _require(isinstance(page, Page), "page 必须是 Page")
    _non_empty(owner, "page.owner")
    _non_empty(label, "page.label")
    if icon is not None:
        _non_empty(icon, "page.icon")

    root_id = page_id(page_name)
    props: JsonObject = {"label": label}
    if icon is not None:
        props["icon"] = icon
    content = serialize_node_slot(
        page.content,
        register,
        owner=owner,
        node_id=f"{root_id}.content",
    )
    root = Slot(
        root_id,
        PAGE_KIND,
        owner=owner,
        props=props,
        layout=Layout(flow="column", capacity="many"),
        children=[content],
    )
    return LocalTree(owner=owner, root=root, mount_at=PAGE_MOUNT_AT)


def serialize_nav_slot(
    links: Sequence[NavLink],
    register: Register,
    *,
    owner: str = NAV_OWNER,
) -> LocalTree:
    """页面登记 → 挂在 dendro.window.nav 上的导航局部树。

    每个页面一个 `dendro:page-link`，click 事件交给 register；id 用
    `ui.nav.<page>`，与页面树的 `page.<name>.*` 前缀不同，跨树不撞。
    """
    _non_empty(owner, "nav.owner")
    children: list[Slot] = []
    seen: set[str] = set()
    for link in links:
        _require(isinstance(link, NavLink), "links 里只能是 NavLink")
        page_name = _non_empty(link.page, "nav.page")
        _require(page_name not in seen, f"重复导航页面: {page_name}")
        seen.add(page_name)
        _require(callable(link.on_click), f"nav.{page_name}.on_click 必须是可调用对象")
        props: JsonObject = {"label": _non_empty(link.label, f"nav.{page_name}.label")}
        if link.icon is not None:
            props["icon"] = _non_empty(link.icon, f"nav.{page_name}.icon")
        if link.active:
            props["active"] = True
        handler = link.on_click
        # 先在当前代次里登记；serialize_view 序列化时按同一对象取回同一个 id。
        register(handler)
        children.append(
            Slot(
                f"{NAV_ROOT_ID}.{page_name}",
                "dendro:page-link",
                owner=owner,
                props=props,
                events={"click": handler},
            )
        )
    root = Slot(
        NAV_ROOT_ID,
        NAV_KIND,
        owner=owner,
        layout=Layout(flow="column", capacity="many"),
        children=children,
    )
    return LocalTree(owner=owner, root=root, mount_at=NAV_MOUNT_AT)


__all__ = [
    "EVENT_PREFIX",
    "NAMESPACE",
    "NAV_MOUNT_AT",
    "NAV_OWNER",
    "NAV_ROOT_ID",
    "PAGE_KIND",
    "PAGE_MOUNT_AT",
    "NavLink",
    "event_name",
    "kind_of",
    "page_id",
    "serialize_nav_slot",
    "serialize_node_slot",
    "serialize_page_slot",
]
