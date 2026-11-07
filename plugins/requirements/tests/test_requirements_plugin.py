"""requirements 插件的行为测试:用假 PluginContext 记录登记、事件与状态折叠。

命令的返回值与事件载荷、reducer 折叠、状态白名单、查询形状、按钮绑定作用域、
清单与实现的对应关系,以及 C3 节点树是否合法,都在这里钉住。
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any, cast

import jsonschema
import pytest
from omora_plugins_requirements import SET_STATUS_COMMAND, plugin
from omora_sdk import Node
from requirements_fakes import NOW, FakeContext

ROOT = Path(__file__).resolve().parents[3]


def _activated() -> FakeContext:
    context = FakeContext()
    asyncio.run(plugin.activate(context))
    return context


def _load(path: Path) -> dict[str, Any]:
    return cast("dict[str, Any]", json.loads(path.read_text(encoding="utf-8")))


def _manifest() -> dict[str, Any]:
    return _load(ROOT / "plugins" / "requirements" / "plugin.json")


def _nodes(context: FakeContext) -> list[Node]:
    view = context.fake_ui.contributions["requirements.main"]
    return list(view(context.fake_state.read()))


def _find(nodes: Sequence[Node], node_type: str) -> list[Node]:
    """递归找出指定类型的节点。"""
    found = [node for node in nodes if node["type"] == node_type]
    for node in nodes:
        children = node.get("children")
        if isinstance(children, list):
            found.extend(_find(cast("list[Node]", children), node_type))
    return found


def _rows(context: FakeContext) -> list[Node]:
    """需求列表的每项模板。"""
    list_node = _find(_nodes(context), "List")[0]
    return cast("list[Node]", list_node.get("children"))


def _items(context: FakeContext) -> list[dict[str, object]]:
    """切片里已折叠的需求条目。"""
    state = cast("dict[str, object]", context.fake_state.read())
    return cast("list[dict[str, object]]", state["items"])


def _create(context: FakeContext, title: str, project_id: str) -> object:
    return asyncio.run(
        context.fake_commands.invoke(
            "requirements.create", {"title": title, "projectId": project_id}
        )
    )


def test_activate_registers_commands_query_and_contribution() -> None:
    context = _activated()

    assert set(context.fake_commands.handlers) == {
        "requirements.create",
        "requirements.setStatus",
    }
    assert set(context.fake_queries.handlers) == {"requirements.list"}
    assert set(context.fake_ui.contributions) == {"requirements.main"}
    assert set(context.fake_state.reducers) == {
        "requirements.created",
        "requirements.statusChanged",
        "projects.focused",
    }


def _provide_project_lookup(context: FakeContext, title: str) -> None:
    async def lookup(args: Mapping[str, object]) -> object:
        return {"id": args.get("id"), "title": title}

    context.fake_services.provide("projects.lookup", lookup)


def test_create_emits_created_event_with_project_and_initial_todo_status() -> None:
    context = _activated()
    _provide_project_lookup(context, "Omora P1")

    result = _create(context, "导出需求", "project-1")

    assert result == {"id": "requirement-1"}
    assert context.fake_events.emitted == [
        (
            "requirements.created",
            {
                "id": "requirement-1",
                "title": "导出需求",
                "projectId": "project-1",
                "projectTitle": "Omora P1",
                "status": "todo",
                "at": NOW.isoformat(),
            },
        )
    ]


def test_create_still_works_when_projects_plugin_is_absent() -> None:
    context = _activated()

    asyncio.run(context.fake_commands.invoke("requirements.create", {"title": "独立需求"}))

    event_type, data = context.fake_events.emitted[-1]
    assert event_type == "requirements.created"
    assert data["projectTitle"] == "", "拿不到项目名时留空,而不是让建需求失败"


def test_created_event_folds_into_items() -> None:
    context = _activated()
    _create(context, "导出需求", "project-1")
    context.replay()

    state = context.fake_state.read()
    items = cast("list[dict[str, object]]", state["items"])
    assert items[0]["title"] == "导出需求"
    assert state["focusLabel"] == "全部需求", "没有聚焦项目时展示全部"
    assert cast("list[object]", state["visible"]) == items, "未聚焦时可见列表就是全部"


def test_set_status_emits_status_changed_event() -> None:
    context = _activated()

    asyncio.run(
        context.fake_commands.invoke(
            "requirements.setStatus", {"id": "requirement-1", "status": "done"}
        )
    )

    assert context.fake_events.emitted == [
        ("requirements.statusChanged", {"id": "requirement-1", "status": "done"})
    ]


@pytest.mark.parametrize(
    "args",
    [
        {"id": "requirement-1", "status": "archived"},
        {"id": "requirement-1", "status": "DONE"},
        {"id": "requirement-1", "status": ""},
        {"id": "requirement-1"},
    ],
)
def test_set_status_rejects_values_outside_the_status_set(args: dict[str, object]) -> None:
    context = _activated()

    with pytest.raises(ValueError):
        asyncio.run(context.fake_commands.invoke("requirements.setStatus", args))

    assert context.fake_events.emitted == []


def test_status_changed_event_updates_only_matching_requirement() -> None:
    context = _activated()
    _create(context, "保留", "project-1")
    _create(context, "推进", "project-1")
    context.replay()

    asyncio.run(
        context.fake_commands.invoke(
            "requirements.setStatus", {"id": "requirement-2", "status": "done"}
        )
    )
    context.replay()

    assert [item["status"] for item in _items(context)] == ["todo", "done"]


def test_list_returns_items_shape_before_any_requirement() -> None:
    context = _activated()

    assert asyncio.run(context.fake_queries.invoke("requirements.list", {})) == {"items": []}


def test_list_returns_folded_requirements_as_items() -> None:
    context = _activated()
    _create(context, "导出需求", "project-1")
    context.replay()

    assert asyncio.run(context.fake_queries.invoke("requirements.list", {})) == {
        "items": _items(context)
    }


def test_main_view_passes_c3_schema() -> None:
    nodes = _nodes(_activated())
    schema = _load(ROOT / "protocol" / "c3-node.schema.json")

    assert [node["type"] for node in nodes] == ["Stack"]
    for node in nodes:
        jsonschema.validate(instance=node, schema=schema)


def test_requirement_row_shows_title_and_status() -> None:
    texts = _find(_rows(_activated()), "Text")

    props = [cast("dict[str, object]", node["props"]) for node in texts]
    assert [entry["text"] for entry in props] == [
        "$item.title",
        "$item.projectTitle",
        "$item.statusLabel",
    ]


def test_advance_button_binds_item_id_and_doing_status() -> None:
    buttons = _find(_rows(_activated()), "Button")

    assert len(buttons) == 1
    assert buttons[0]["on"] == {
        "click": {
            "command": SET_STATUS_COMMAND,
            "args": {"id": "$item.id", "status": "$item.nextStatus"},
        }
    }


def test_list_declares_empty_state_text() -> None:
    list_node = _find(_nodes(_activated()), "List")[0]

    assert list_node["props"] == {"items": "$visible", "emptyText": "还没有需求"}


def test_registered_commands_and_slots_match_manifest() -> None:
    context = _activated()
    payload = _manifest()

    declared_commands = {entry["id"] for entry in payload["contributes"]["commands"]}
    declared_slots = {entry["id"] for entry in payload["contributes"]["slots"]}

    assert set(context.fake_commands.handlers) == declared_commands
    assert set(context.fake_ui.contributions) == declared_slots


def test_manifest_passes_c2_schema() -> None:
    jsonschema.validate(
        instance=_manifest(), schema=_load(ROOT / "protocol" / "c2-manifest.schema.json")
    )


def test_manifest_version_matches_repository_version() -> None:
    expected = (ROOT / "VERSION").read_text(encoding="utf-8").strip()

    assert _manifest()["version"] == expected


def test_focus_event_filters_the_visible_list() -> None:
    context = _activated()
    _create(context, "写作台需求", "project-1")
    _create(context, "内核需求", "project-2")
    context.replay()

    asyncio.run(
        context.fake_events.emit("projects.focused", {"id": "project-1", "title": "写作台"})
    )
    context.replay()

    state = context.fake_state.read()
    visible = cast("list[dict[str, object]]", state["visible"])
    assert [item["title"] for item in visible] == ["写作台需求"], "只看当前项目"
    assert state["focusLabel"] == "项目:写作台"


def test_focusing_nothing_shows_everything_again() -> None:
    context = _activated()
    _create(context, "写作台需求", "project-1")
    _create(context, "内核需求", "project-2")
    context.replay()

    asyncio.run(context.fake_events.emit("projects.focused", {"id": "", "title": ""}))
    context.replay()

    state = context.fake_state.read()
    assert len(cast("list[object]", state["visible"])) == 2
    assert state["focusLabel"] == "全部需求"
