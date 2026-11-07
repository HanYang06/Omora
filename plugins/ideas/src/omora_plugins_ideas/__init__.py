"""官方 ideas 插件。只允许依赖 omora_sdk。"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import cast

from omora_sdk import Handler, Node, Plugin, PluginContext, card, input_, list_, stack, text

PLUGIN_ID = "omora.ideas"
SIDEBAR_CONTRIBUTION_ID = "ideas.sidebar"
CREATE_COMMAND = "ideas.create"
ARCHIVE_COMMAND = "ideas.archive"
CREATED_EVENT = "ideas.created"
ARCHIVED_EVENT = "ideas.archived"


def _item_list(state: dict[str, object]) -> list[dict[str, object]]:
    """取出状态切片里的 items 数组;切片还没初始化时就地创建。"""
    raw = state.get("items")
    if isinstance(raw, list):
        return cast("list[dict[str, object]]", raw)
    items: list[dict[str, object]] = []
    state["items"] = items
    return items


def _fold_created(state: dict[str, object], data: Mapping[str, object]) -> None:
    """把 ideas.created 折叠成一条新条目。"""
    identifier = data.get("id")
    title = data.get("title")
    if not isinstance(identifier, str) or not isinstance(title, str):
        return
    _item_list(state).append({"id": identifier, "title": title, "at": data.get("at")})


def _fold_archived(state: dict[str, object], data: Mapping[str, object]) -> None:
    """把 ideas.archived 对应的条目从 items 移除。"""
    identifier = data.get("id")
    if not isinstance(identifier, str):
        return
    items = _item_list(state)
    items[:] = [item for item in items if item.get("id") != identifier]


def _title(args: Mapping[str, object]) -> str:
    """命令参数里的标题;不是字符串时退回空串,保证事件形状稳定。"""
    value = args.get("title")
    return value if isinstance(value, str) else ""


def _create_command(ctx: PluginContext) -> Handler:
    """ideas.create:只发事件,状态由 reducer 折叠。"""

    async def create(args: Mapping[str, object]) -> object:
        idea_id = ctx.ids.next()
        await ctx.events.emit(
            CREATED_EVENT,
            {"id": idea_id, "title": _title(args), "at": ctx.clock.now().isoformat()},
        )
        return {"id": idea_id}

    return create


def _archive_command(ctx: PluginContext) -> Handler:
    """ideas.archive:只发事件,状态由 reducer 折叠。"""

    async def archive(args: Mapping[str, object]) -> object:
        await ctx.events.emit(ARCHIVED_EVENT, {"id": args.get("id")})
        return None

    return archive


def _view(state: Mapping[str, object]) -> Sequence[Node]:
    """sidebar 贡献:标题、灵感列表与记录输入框;绑定在本插件自己的切片里求值。"""
    return [
        stack(
            [
                text("灵感", variant="title"),
                list_(
                    "$items",
                    [card([text("$item.at", variant="caption")], title="$item.title")],
                    empty_text="还没有内容",
                ),
                input_("记一句", submit=CREATE_COMMAND, args={"title": "$value"}),
            ]
        )
    ]


class IdeasPlugin:
    """插件入口:登记项全部挂在宿主作用域上,自身不持有可变状态。"""

    async def activate(self, ctx: PluginContext) -> None:
        """登记两条折叠规则、两个命令与一个 sidebar 贡献。"""
        ctx.state.register(CREATED_EVENT, _fold_created)
        ctx.state.register(ARCHIVED_EVENT, _fold_archived)
        ctx.commands.register(CREATE_COMMAND, _create_command(ctx))
        ctx.commands.register(ARCHIVE_COMMAND, _archive_command(ctx))
        ctx.ui.contribute(SIDEBAR_CONTRIBUTION_ID, _view)

    async def deactivate(self) -> None:
        """登记项随宿主作用域回收,插件没有需要手动清理的东西。"""


# 清单 entry 指向本属性;类型注解让 pyright 校验它确实满足 Plugin 协议。
plugin: Plugin = IdeasPlugin()

__all__ = [
    "ARCHIVED_EVENT",
    "ARCHIVE_COMMAND",
    "CREATED_EVENT",
    "CREATE_COMMAND",
    "PLUGIN_ID",
    "SIDEBAR_CONTRIBUTION_ID",
    "IdeasPlugin",
    "plugin",
]
