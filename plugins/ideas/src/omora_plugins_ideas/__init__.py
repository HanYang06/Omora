"""官方 ideas 插件。只允许依赖 omora_sdk。"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import cast

from omora_sdk import Handler, Node, Plugin, PluginContext, button, card, input_, list_, stack, text

PLUGIN_ID = "omora.ideas"
CAPTURE_CONTRIBUTION_ID = "ideas.capture"
INBOX_CONTRIBUTION_ID = "ideas.inbox"
CREATE_COMMAND = "ideas.create"
ARCHIVE_COMMAND = "ideas.archive"
CREATED_EVENT = "ideas.created"
ARCHIVED_EVENT = "ideas.archived"
ASSIGN_COMMAND = "ideas.assign"
ASSIGNED_EVENT = "ideas.assigned"
PROJECT_LOOKUP_SERVICE = "projects.lookup"


def _item_list(state: dict[str, object]) -> list[dict[str, object]]:
    """取出状态切片里的 items 数组;切片还没初始化时就地创建。"""
    raw = state.get("items")
    if isinstance(raw, list):
        return cast("list[dict[str, object]]", raw)
    items: list[dict[str, object]] = []
    state["items"] = items
    return items


def _short_time(value: object) -> str:
    """把 ISO 时间裁成给人看的短格式;不是字符串就留空。"""
    if not isinstance(value, str) or len(value) < 16:
        return ""
    return f"{value[5:10]} {value[11:16]}"


def _fold_created(state: dict[str, object], data: Mapping[str, object]) -> None:
    """把 ideas.created 折叠成一条新条目。"""
    identifier = data.get("id")
    title = data.get("title")
    if not isinstance(identifier, str) or not isinstance(title, str):
        return
    _item_list(state).append(
        {
            "id": identifier,
            "title": title,
            "at": data.get("at"),
            "atLabel": _short_time(data.get("at")),
            "projectTitle": "",
        }
    )


def _fold_archived(state: dict[str, object], data: Mapping[str, object]) -> None:
    """把 ideas.archived 对应的条目从 items 移除。"""
    identifier = data.get("id")
    if not isinstance(identifier, str):
        return
    items = _item_list(state)
    items[:] = [item for item in items if item.get("id") != identifier]


def _fold_assigned(state: dict[str, object], data: Mapping[str, object]) -> None:
    """把 ideas.assigned 折叠成条目的项目归属;找不到条目时什么也不做。"""
    identifier = data.get("id")
    if not isinstance(identifier, str):
        return
    for item in _item_list(state):
        if item.get("id") == identifier:
            item["projectId"] = data.get("projectId")
            item["projectTitle"] = data.get("projectTitle")


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


def _idea_title(ctx: PluginContext, idea_id: str) -> str:
    """从自己的切片里取标题;找不到就留空,分诊不能因此失败。"""
    items = ctx.state.read().get("items")
    if not isinstance(items, list):
        return ""
    for entry in cast("list[object]", items):
        if isinstance(entry, dict) and cast("dict[str, object]", entry).get("id") == idea_id:
            title = cast("dict[str, object]", entry).get("title")
            return title if isinstance(title, str) else ""
    return ""


def _assign_command(ctx: PluginContext) -> Handler:
    """ideas.assign:先向 projects 服务确认项目存在,再发事件。"""

    async def assign(args: Mapping[str, object]) -> object:
        idea_id = args.get("id")
        project_id = args.get("projectId")
        if not isinstance(idea_id, str) or not isinstance(project_id, str):
            raise ValueError("ideas.assign 需要 id 与 projectId")
        found = await ctx.services.call(PROJECT_LOOKUP_SERVICE, {"id": project_id})
        title = ""
        if isinstance(found, Mapping):
            raw = cast("Mapping[str, object]", found).get("title")
            title = raw if isinstance(raw, str) else ""
        await ctx.events.emit(
            ASSIGNED_EVENT,
            {
                "id": idea_id,
                "ideaTitle": _idea_title(ctx, idea_id),
                "projectId": project_id,
                "projectTitle": title,
            },
        )
        return None

    return assign


def _capture_view(state: Mapping[str, object]) -> Sequence[Node]:
    """侧边栏贡献:只放输入框,捕捉要永远在手边。"""
    return [input_("记一句,回车即存", submit=CREATE_COMMAND, args={"title": "$value"})]


def _inbox_view(state: Mapping[str, object]) -> Sequence[Node]:
    """主区贡献:灵感收件箱;绑定在本插件自己的切片里求值。"""
    return [
        stack(
            [
                text("灵感", variant="title"),
                list_(
                    "$items",
                    [
                        card(
                            [
                                stack(
                                    [
                                        text("$item.projectTitle", variant="caption"),
                                        text("$item.atLabel", variant="caption"),
                                        button(
                                            "归档",
                                            command=ARCHIVE_COMMAND,
                                            args={"id": "$item.id"},
                                            variant="ghost",
                                        ),
                                    ],
                                    direction="horizontal",
                                    gap=12,
                                )
                            ],
                            title="$item.title",
                        )
                    ],
                    empty_text="收件箱是空的",
                ),
            ]
        )
    ]


class IdeasPlugin:
    """插件入口:登记项全部挂在宿主作用域上,自身不持有可变状态。"""

    async def activate(self, ctx: PluginContext) -> None:
        """登记两条折叠规则、两个命令与一个 sidebar 贡献。"""
        ctx.state.register(CREATED_EVENT, _fold_created)
        ctx.state.register(ARCHIVED_EVENT, _fold_archived)
        ctx.state.register(ASSIGNED_EVENT, _fold_assigned)
        ctx.commands.register(CREATE_COMMAND, _create_command(ctx))
        ctx.commands.register(ARCHIVE_COMMAND, _archive_command(ctx))
        ctx.commands.register(ASSIGN_COMMAND, _assign_command(ctx))
        ctx.ui.contribute(CAPTURE_CONTRIBUTION_ID, _capture_view)
        ctx.ui.contribute(INBOX_CONTRIBUTION_ID, _inbox_view)

    async def deactivate(self) -> None:
        """登记项随宿主作用域回收,插件没有需要手动清理的东西。"""


# 清单 entry 指向本属性;类型注解让 pyright 校验它确实满足 Plugin 协议。
plugin: Plugin = IdeasPlugin()

__all__ = [
    "ARCHIVED_EVENT",
    "ARCHIVE_COMMAND",
    "ASSIGNED_EVENT",
    "ASSIGN_COMMAND",
    "CAPTURE_CONTRIBUTION_ID",
    "CREATED_EVENT",
    "CREATE_COMMAND",
    "INBOX_CONTRIBUTION_ID",
    "PLUGIN_ID",
    "IdeasPlugin",
    "plugin",
]
