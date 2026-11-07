"""官方 projects 插件。只允许依赖 omora_sdk。

命令只发事件,状态由 reducer 折叠;查询与服务读的是宿主投影出来的本插件切片。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import cast

from omora_sdk import Handler, Node, Plugin, PluginContext, list_, stack, text

PLUGIN_ID = "omora.projects"
SIDEBAR_CONTRIBUTION_ID = "projects.sidebar"
CREATE_COMMAND = "projects.create"
ARCHIVE_COMMAND = "projects.archive"
LIST_QUERY = "projects.list"
LOOKUP_SERVICE = "projects.lookup"
CREATED_EVENT = "projects.created"
ARCHIVED_EVENT = "projects.archived"
IDEA_ASSIGNED_EVENT = "ideas.assigned"


def _item_list(state: dict[str, object]) -> list[dict[str, object]]:
    """取出状态切片里的 items 数组;切片还没初始化时就地创建。"""
    raw = state.get("items")
    if isinstance(raw, list):
        return cast("list[dict[str, object]]", raw)
    items: list[dict[str, object]] = []
    state["items"] = items
    return items


def _project_items(state: Mapping[str, object]) -> list[dict[str, object]]:
    """只读地取出已折叠的项目条目;还没折叠过时视为空。"""
    raw = state.get("items")
    if not isinstance(raw, list):
        return []
    return [
        cast("dict[str, object]", entry)
        for entry in cast("list[object]", raw)
        if isinstance(entry, dict)
    ]


def _fold_created(state: dict[str, object], data: Mapping[str, object]) -> None:
    """把 projects.created 折叠成一条新条目。"""
    identifier = data.get("id")
    title = data.get("title")
    if not isinstance(identifier, str) or not isinstance(title, str):
        return
    _item_list(state).append(
        {
            "id": identifier,
            "title": title,
            "at": data.get("at"),
            "ideas": [],
            "ideaCountLabel": "0 条灵感",
        }
    )


def _fold_archived(state: dict[str, object], data: Mapping[str, object]) -> None:
    """把 projects.archived 对应的条目从 items 移除。"""
    identifier = data.get("id")
    if not isinstance(identifier, str):
        return
    items = _item_list(state)
    items[:] = [item for item in items if item.get("id") != identifier]


def _fold_idea_assigned(state: dict[str, object], data: Mapping[str, object]) -> None:
    """别的插件把灵感分诊到本项目时,在自己的切片里留一份副本用于展示。"""
    project_id = data.get("projectId")
    idea_id = data.get("id")
    if not isinstance(project_id, str) or not isinstance(idea_id, str):
        return
    for item in _item_list(state):
        if item.get("id") != project_id:
            continue
        ideas = item.get("ideas")
        if not isinstance(ideas, list):
            ideas = []
            item["ideas"] = ideas
        cast("list[object]", ideas).append({"id": idea_id, "title": data.get("ideaTitle", "")})
        item["ideaCountLabel"] = f"{len(cast('list[object]', ideas))} 条灵感"


def _string_arg(args: Mapping[str, object], key: str) -> str:
    """命令参数里的字符串;不是字符串时退回空串,保证事件形状稳定。"""
    value = args.get(key)
    return value if isinstance(value, str) else ""


def _create_command(ctx: PluginContext) -> Handler:
    """projects.create:只发事件,状态由 reducer 折叠。"""

    async def create(args: Mapping[str, object]) -> object:
        project_id = ctx.ids.next()
        await ctx.events.emit(
            CREATED_EVENT,
            {
                "id": project_id,
                "title": _string_arg(args, "title"),
                "at": ctx.clock.now().isoformat(),
            },
        )
        return {"id": project_id}

    return create


def _archive_command(ctx: PluginContext) -> Handler:
    """projects.archive:只发事件,状态由 reducer 折叠。"""

    async def archive(args: Mapping[str, object]) -> object:
        await ctx.events.emit(ARCHIVED_EVENT, {"id": _string_arg(args, "id")})
        return None

    return archive


def _list_query(ctx: PluginContext) -> Handler:
    """projects.list:按 QueryResult 的要求返回 {"items": [...]}。"""

    async def list_projects(_args: Mapping[str, object]) -> object:
        return {"items": [dict(item) for item in _project_items(ctx.state.read())]}

    return list_projects


def _lookup_service(ctx: PluginContext) -> Handler:
    """projects.lookup:给别的插件做归属校验;id 不存在时抛 ValueError。"""

    async def lookup(args: Mapping[str, object]) -> object:
        identifier = _string_arg(args, "id")
        for item in _project_items(ctx.state.read()):
            if item.get("id") == identifier:
                return {"id": identifier, "title": item.get("title")}
        raise ValueError(f"项目不存在: {identifier!r}")

    return lookup


def _view(_state: Mapping[str, object]) -> Sequence[Node]:
    """sidebar 贡献:标题与项目列表;列表数据经 $items 绑定到本插件切片。"""
    return [
        stack(
            [
                text("项目", variant="title"),
                list_(
                    "$items",
                    [
                        stack(
                            [
                                text("$item.title", variant="subtitle"),
                                text("$item.ideaCountLabel", variant="caption"),
                            ],
                            gap=2,
                        )
                    ],
                    empty_text="还没有项目",
                ),
            ]
        )
    ]


class ProjectsPlugin:
    """插件入口:登记项全部挂在宿主作用域上,自身不持有可变状态。"""

    async def activate(self, ctx: PluginContext) -> None:
        """登记两条折叠规则、两个命令、一个查询、一个服务与一个 sidebar 贡献。"""
        ctx.state.register(CREATED_EVENT, _fold_created)
        ctx.state.register(ARCHIVED_EVENT, _fold_archived)
        ctx.state.register(IDEA_ASSIGNED_EVENT, _fold_idea_assigned)
        ctx.commands.register(CREATE_COMMAND, _create_command(ctx))
        ctx.commands.register(ARCHIVE_COMMAND, _archive_command(ctx))
        ctx.queries.register(LIST_QUERY, _list_query(ctx))
        ctx.services.provide(LOOKUP_SERVICE, _lookup_service(ctx))
        ctx.ui.contribute(SIDEBAR_CONTRIBUTION_ID, _view)

    async def deactivate(self) -> None:
        """登记项随宿主作用域回收,插件没有需要手动清理的东西。"""


# 清单 entry 指向本属性;类型注解让 pyright 校验它确实满足 Plugin 协议。
plugin: Plugin = ProjectsPlugin()

__all__ = [
    "ARCHIVED_EVENT",
    "ARCHIVE_COMMAND",
    "CREATED_EVENT",
    "CREATE_COMMAND",
    "IDEA_ASSIGNED_EVENT",
    "LIST_QUERY",
    "LOOKUP_SERVICE",
    "PLUGIN_ID",
    "SIDEBAR_CONTRIBUTION_ID",
    "ProjectsPlugin",
    "plugin",
]
