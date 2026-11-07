"""需求区的界面:节点树是数据,这里只管长什么样。"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from omora_sdk import Node, button, card, input_, list_, stack, text

from .constants import CREATE_COMMAND, REMOVE_COMMAND, SET_STATUS_COMMAND


def build_view(_state: Mapping[str, object]) -> Sequence[Node]:
    """main 贡献:需求列表,每条显示标题、项目、状态与两个操作。"""
    return [
        stack(
            [
                text("需求", variant="title"),
                text("$focusLabel", variant="caption"),
                input_(
                    "新需求",
                    submit=CREATE_COMMAND,
                    args={"title": "$value", "projectId": "$focusedProjectId"},
                ),
                list_(
                    "$visible",
                    [
                        card(
                            [
                                text("$item.title", variant="subtitle"),
                                stack(
                                    [
                                        text("$item.projectTitle", variant="caption"),
                                        text("$item.statusLabel", variant="caption"),
                                        button(
                                            "推进",
                                            command=SET_STATUS_COMMAND,
                                            args={"id": "$item.id", "status": "$item.nextStatus"},
                                            variant="ghost",
                                        ),
                                        button(
                                            "删除",
                                            command=REMOVE_COMMAND,
                                            args={"id": "$item.id"},
                                            variant="ghost",
                                        ),
                                    ],
                                    direction="horizontal",
                                    gap=12,
                                ),
                            ]
                        )
                    ],
                    empty_text="还没有需求",
                ),
            ]
        )
    ]
