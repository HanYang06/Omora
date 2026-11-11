"""设置页：把清单行画成页面。页面只读数据，动作交给 manager 的开关。"""

from __future__ import annotations

from collections.abc import Callable, Sequence

from omora.sdk.ui import Button, Column, Handler, Item, List, Node, Page, Text

from ._model import ACTIVE, PHASE_TEXT, Row

Toggler = Callable[[str], Handler]


def conditions_text(row: Row) -> str:
    parts: list[str] = []
    if row.metadata.platforms:
        parts.append("平台: " + "/".join(row.metadata.platforms))
    if row.metadata.capabilities:
        parts.append("需要: " + ", ".join(row.metadata.capabilities))
    if row.metadata.requires:
        parts.append("依赖: " + ", ".join(row.metadata.requires))
    if not row.metadata.listed:
        parts.append("默认隐藏")
    return " · ".join(parts)


def build_page(
    rows: Sequence[Row], *, devices: tuple[str, ...], reported: bool, toggler: Toggler
) -> Page:
    """清单 → 设置页；设备事实只做展示，不参与开关判断。"""
    text = "、".join(devices) if reported else "未上报"
    summary = Text(f"客户端设备: {text}", kind="muted")
    if not rows:
        return Page(content=Column(summary, Text("没有插件。")), meta="")
    items = List(*[item(row, toggler) for row in rows])
    active = sum(1 for row in rows if row.phase == ACTIVE)
    return Page(content=Column(summary, items), meta=f"{active}/{len(rows)} 运行中")


def item(row: Row, toggler: Toggler) -> Item:
    details = [row.description]
    conditions = conditions_text(row)
    if conditions:
        details.append(conditions)
    if row.reason is not None:
        details.append(row.reason.message)
    actions: list[Node] = []
    if row.bootstrap:
        actions.append(Text("启动项", kind="muted"))
    else:
        actions.append(
            Button("禁用" if row.enabled else "启用", variant="ghost", on_click=toggler(row.name))
        )
    body = " · ".join(part for part in details if part)
    return Item(
        row.name, Text(body, kind="muted"), *actions, meta=PHASE_TEXT.get(row.phase, row.phase)
    )
