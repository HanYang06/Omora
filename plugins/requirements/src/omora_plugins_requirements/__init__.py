"""官方 requirements 插件。只允许依赖 omora_sdk。

需求挂在项目下;状态流转只允许 todo / doing / done,非法值在命令层就被拒绝。
命令只发事件,状态由 reducer 折叠;查询返回 {"items": [...]}。
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import cast

from omora_sdk import Handler, Plugin, PluginContext

from .constants import (
    CREATE_COMMAND,
    CREATED_EVENT,
    FOCUSED_EVENT,
    LIST_QUERY,
    MAIN_CONTRIBUTION_ID,
    PLUGIN_ID,
    PROJECT_LOOKUP_SERVICE,
    REMOVE_COMMAND,
    REMOVED_EVENT,
    SET_STATUS_COMMAND,
    STATUS_CHANGED_EVENT,
    STATUS_DOING,
    STATUS_DONE,
    STATUS_TODO,
    STATUSES,
)
from .views import build_view


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
NEXT_STATUS = {"todo": STATUS_DOING, "doing": STATUS_DONE, "done": STATUS_DONE}


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
            "projectTitle": data.get("projectTitle", ""),
            "status": data.get("status"),
            "statusLabel": _label(data.get("status")),
            "nextStatus": NEXT_STATUS.get(str(data.get("status")), STATUS_DONE),
            "at": data.get("at"),
        }
    )
    _recompute(state)


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
            item["nextStatus"] = NEXT_STATUS.get(status, STATUS_DONE)
    _recompute(state)


def _fold_removed(state: dict[str, object], data: Mapping[str, object]) -> None:
    """把 requirements.removed 对应的条目移除;其余条目不受影响。"""
    identifier = data.get("id")
    if not isinstance(identifier, str):
        return
    items = _item_list(state)
    items[:] = [item for item in items if item.get("id") != identifier]
    _recompute(state)


def _recompute(state: dict[str, object]) -> None:
    """按当前聚焦的项目重算可见列表;没聚焦就是全部。前端只渲染 visible。"""
    focused = state.get("focusedProjectId")
    selected = focused if isinstance(focused, str) and focused else None
    items = _requirement_items(state)
    state["visible"] = [
        item for item in items if selected is None or item.get("projectId") == selected
    ]
    title = state.get("focusedProjectTitle")
    if selected is None:
        state["focusLabel"] = "全部需求"
    elif isinstance(title, str) and title:
        state["focusLabel"] = f"项目:{title}"
    else:
        state["focusLabel"] = "这个项目"


def _fold_focus(state: dict[str, object], data: Mapping[str, object]) -> None:
    """别的插件广播「看哪个项目」,这里据此过滤自己的列表。"""
    identifier = data.get("id")
    state["focusedProjectId"] = identifier if isinstance(identifier, str) else ""
    title = data.get("title")
    state["focusedProjectTitle"] = title if isinstance(title, str) else ""
    _recompute(state)


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


async def _project_title(ctx: PluginContext, project_id: str) -> str:
    """问 projects 要项目名;没装或查不到就留空,不让建需求失败。"""
    if not project_id:
        return ""
    try:
        found = await ctx.services.call(PROJECT_LOOKUP_SERVICE, {"id": project_id})
    except Exception:
        ctx.log.warn(f"无法解析项目 {project_id},需求将不显示项目名")
        return ""
    if not isinstance(found, Mapping):
        return ""
    title = cast("Mapping[str, object]", found).get("title")
    return title if isinstance(title, str) else ""


def _create_command(ctx: PluginContext) -> Handler:
    """requirements.create:新建需求,初始状态 todo。"""

    async def create(args: Mapping[str, object]) -> object:
        title = _string_arg(args, "title").strip()
        if not title:
            raise ValueError("需求不能没有标题")
        requirement_id = ctx.ids.next()
        project_id = _string_arg(args, "projectId")
        await ctx.events.emit(
            CREATED_EVENT,
            {
                "id": requirement_id,
                "title": title,
                "projectId": project_id,
                "projectTitle": await _project_title(ctx, project_id),
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


def _remove_command(ctx: PluginContext) -> Handler:
    """requirements.remove:删掉一条需求。"""

    async def remove(args: Mapping[str, object]) -> object:
        identifier = _string_arg(args, "id")
        if not identifier:
            raise ValueError("删除需求需要 id")
        await ctx.events.emit(REMOVED_EVENT, {"id": identifier})
        return None

    return remove


def _list_query(ctx: PluginContext) -> Handler:
    """requirements.list:按 QueryResult 的要求返回 {"items": [...]}。"""

    async def list_requirements(_args: Mapping[str, object]) -> object:
        return {"items": [dict(item) for item in _requirement_items(ctx.state.read())]}

    return list_requirements


class RequirementsPlugin:
    """插件入口:登记项全部挂在宿主作用域上,自身不持有可变状态。"""

    async def activate(self, ctx: PluginContext) -> None:
        """登记两条折叠规则、两个命令、一个查询与一个 main 贡献。"""
        ctx.state.register(CREATED_EVENT, _fold_created)
        ctx.state.register(STATUS_CHANGED_EVENT, _fold_status_changed)
        ctx.state.register(FOCUSED_EVENT, _fold_focus)
        ctx.state.register(REMOVED_EVENT, _fold_removed)
        ctx.commands.register(CREATE_COMMAND, _create_command(ctx))
        ctx.commands.register(SET_STATUS_COMMAND, _set_status_command(ctx))
        ctx.commands.register(REMOVE_COMMAND, _remove_command(ctx))
        ctx.queries.register(LIST_QUERY, _list_query(ctx))
        ctx.ui.contribute(MAIN_CONTRIBUTION_ID, build_view)

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
