"""官方 requirements 插件。只允许依赖 omora_sdk。

需求挂在项目下;状态流转只允许 todo / doing / done,非法值在命令层就被拒绝。
命令只发事件,状态由 reducer 折叠;查询返回 {"items": [...]}。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import cast

from omora_sdk import (
    Handler,
    Node,
    Plugin,
    PluginContext,
    button,
    card,
    list_,
    stack,
    text,
)

PLUGIN_ID = "omora.requirements"
MAIN_CONTRIBUTION_ID = "requirements.main"
CREATE_COMMAND = "requirements.create"
SET_STATUS_COMMAND = "requirements.setStatus"
LIST_QUERY = "requirements.list"
CREATED_EVENT = "requirements.created"
STATUS_CHANGED_EVENT = "requirements.statusChanged"

STATUS_TODO = "todo"
STATUS_DOING = "doing"
STATUS_DONE = "done"
STATUSES = frozenset({STATUS_TODO, STATUS_DOING, STATUS_DONE})


def _item_list(state: dict[str, object]) -> list[dict[str, object]]:
    """取出状态切片里的 items 数组;切片还没初始化时就地创建。"""
    raw = state.get("items")
    if isinstance(raw, list):
        return cast("list[dict[str, object]]", raw)
    items: list[dict[str, object]] = []
    state["items"] = items
    return items


def _requirement_items(state: Mapping[str, object]) -> list[dict[str, object]]:
    """只读地取出已折叠的需求条目;还没折叠过时视为空。"""
    raw = state.get("items")
    if not isinstance(raw, list):
        return []
    return [
        cast("dict[str, object]", entry)
        for entry in cast("list[object]", raw)
        if isinstance(entry, dict)
    ]


STATUS_LABELS = {"todo": "待办", "doing": "进行中", "done": "已完成"}


def _label(status: object) -> str:
    """状态是数据,标签是展示;给前端一个能直接渲染的短词。"""
    return STATUS_LABELS.get(status, "") if isinstance(status, str) else ""


def _fold_created(state: dict[str, object], data: Mapping[str, object]) -> None:
    """把 requirements.created 折叠成一条新条目。"""
    identifier = data.get("id")
    title = data.get("title")
    if not isinstance(identifier, str) or not isinstance(title, str):
        return
    _item_list(state).append(
        {
            "id": identifier,
            "title": title,
            "projectId": data.get("projectId"),
            "status": data.get("status"),
            "statusLabel": _label(data.get("status")),
            "at": data.get("at"),
        }
    )


def _fold_status_changed(state: dict[str, object], data: Mapping[str, object]) -> None:
    """把 requirements.statusChanged 折叠到对应条目;其余条目不受影响。"""
    identifier = data.get("id")
    status = data.get("status")
    if not isinstance(identifier, str) or not isinstance(status, str):
        return
    for item in _item_list(state):
        if item.get("id") == identifier:
            item["status"] = status
            item["statusLabel"] = _label(status)


def _string_arg(args: Mapping[str, object], key: str) -> str:
    """命令参数里的字符串;不是字符串时退回空串,保证事件形状稳定。"""
    value = args.get(key)
    return value if isinstance(value, str) else ""


def _status_arg(args: Mapping[str, object]) -> str:
    """校验状态取值;只允许 todo / doing / done,非法值抛 ValueError。"""
    value = args.get("status")
    if not isinstance(value, str) or value not in STATUSES:
        raise ValueError(f"非法需求状态: {value!r}")
    return value


def _create_command(ctx: PluginContext) -> Handler:
    """requirements.create:新建需求,初始状态 todo。"""

    async def create(args: Mapping[str, object]) -> object:
        requirement_id = ctx.ids.next()
        await ctx.events.emit(
            CREATED_EVENT,
            {
                "id": requirement_id,
                "title": _string_arg(args, "title"),
                "projectId": _string_arg(args, "projectId"),
                "status": STATUS_TODO,
                "at": ctx.clock.now().isoformat(),
            },
        )
        return {"id": requirement_id}

    return create


def _set_status_command(ctx: PluginContext) -> Handler:
    """requirements.setStatus:先校验状态,再发事件。"""

    async def set_status(args: Mapping[str, object]) -> object:
        status = _status_arg(args)
        await ctx.events.emit(
            STATUS_CHANGED_EVENT, {"id": _string_arg(args, "id"), "status": status}
        )
        return None

    return set_status


def _list_query(ctx: PluginContext) -> Handler:
    """requirements.list:按 QueryResult 的要求返回 {"items": [...]}。"""

    async def list_requirements(_args: Mapping[str, object]) -> object:
        return {"items": [dict(item) for item in _requirement_items(ctx.state.read())]}

    return list_requirements


def _view(_state: Mapping[str, object]) -> Sequence[Node]:
    """main 贡献:需求列表,每条显示标题、状态与「推进」按钮。"""
    return [
        stack(
            [
                text("需求", variant="title"),
                list_(
                    "$items",
                    [
                        card(
                            [
                                text("$item.title", variant="subtitle"),
                                stack(
                                    [
                                        text("$item.statusLabel", variant="caption"),
                                        button(
                                            "推进",
                                            command=SET_STATUS_COMMAND,
                                            args={"id": "$item.id", "status": STATUS_DOING},
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


class RequirementsPlugin:
    """插件入口:登记项全部挂在宿主作用域上,自身不持有可变状态。"""

    async def activate(self, ctx: PluginContext) -> None:
        """登记两条折叠规则、两个命令、一个查询与一个 main 贡献。"""
        ctx.state.register(CREATED_EVENT, _fold_created)
        ctx.state.register(STATUS_CHANGED_EVENT, _fold_status_changed)
        ctx.commands.register(CREATE_COMMAND, _create_command(ctx))
        ctx.commands.register(SET_STATUS_COMMAND, _set_status_command(ctx))
        ctx.queries.register(LIST_QUERY, _list_query(ctx))
        ctx.ui.contribute(MAIN_CONTRIBUTION_ID, _view)

    async def deactivate(self) -> None:
        """登记项随宿主作用域回收,插件没有需要手动清理的东西。"""


# 清单 entry 指向本属性;类型注解让 pyright 校验它确实满足 Plugin 协议。
plugin: Plugin = RequirementsPlugin()

__all__ = [
    "CREATED_EVENT",
    "CREATE_COMMAND",
    "LIST_QUERY",
    "MAIN_CONTRIBUTION_ID",
    "PLUGIN_ID",
    "SET_STATUS_COMMAND",
    "STATUSES",
    "STATUS_CHANGED_EVENT",
    "STATUS_DOING",
    "STATUS_DONE",
    "STATUS_TODO",
    "RequirementsPlugin",
    "plugin",
]
