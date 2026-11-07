"""projects 插件的行为测试:用假 PluginContext 记录登记、事件与状态折叠。

命令的返回值与它发出的事件载荷、reducer 的折叠结果、查询形状、服务契约、
清单与实现的对应关系,以及 C3 节点树是否合法,都在这里钉住。
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, cast

import jsonschema
import pytest
from omora_plugins_projects import plugin
from omora_sdk import Node
from projects_fakes import NOW, FakeContext

ROOT = Path(__file__).resolve().parents[3]


def _activated() -> FakeContext:
    context = FakeContext()
    asyncio.run(plugin.activate(context))
    return context


def _load(path: Path) -> dict[str, Any]:
    return cast("dict[str, Any]", json.loads(path.read_text(encoding="utf-8")))


def _manifest() -> dict[str, Any]:
    return _load(ROOT / "plugins" / "projects" / "plugin.json")


def _nodes(context: FakeContext) -> list[Node]:
    view = context.fake_ui.contributions["projects.sidebar"]
    return list(view(context.fake_state.read()))


def _children(node: Node) -> list[Node]:
    return cast("list[Node]", node.get("children"))


def test_activate_registers_commands_query_service_and_contribution() -> None:
    context = _activated()

    assert set(context.fake_commands.handlers) == {"projects.create", "projects.archive"}
    assert set(context.fake_queries.handlers) == {"projects.list"}
    assert set(context.fake_services.providers) == {"projects.lookup"}
    assert set(context.fake_ui.contributions) == {"projects.sidebar"}
    assert set(context.fake_state.reducers) == {
        "projects.created",
        "projects.archived",
        "ideas.assigned",
    }


def test_create_emits_created_event_with_injected_id_and_title() -> None:
    context = _activated()

    result = asyncio.run(context.fake_commands.invoke("projects.create", {"title": "写作台"}))

    assert result == {"id": "project-1"}
    assert context.fake_events.emitted == [
        ("projects.created", {"id": "project-1", "title": "写作台", "at": NOW.isoformat()})
    ]


def test_created_event_folds_into_items() -> None:
    context = _activated()
    asyncio.run(context.fake_commands.invoke("projects.create", {"title": "写作台"}))
    context.replay()

    assert context.fake_state.read() == {
        "items": [
            {
                "id": "project-1",
                "title": "写作台",
                "at": NOW.isoformat(),
                "ideas": [],
                "ideaCountLabel": "0 条灵感",
            }
        ]
    }


def test_archived_event_removes_only_that_item() -> None:
    context = _activated()
    asyncio.run(context.fake_commands.invoke("projects.create", {"title": "保留"}))
    asyncio.run(context.fake_commands.invoke("projects.create", {"title": "归档"}))
    context.replay()

    asyncio.run(context.fake_commands.invoke("projects.archive", {"id": "project-2"}))

    assert context.fake_events.emitted[-1] == ("projects.archived", {"id": "project-2"})
    context.replay()
    items = cast("list[dict[str, object]]", context.fake_state.read()["items"])
    assert [item["title"] for item in items] == ["保留"], "只移除被归档的那一个"


def test_list_returns_items_shape_before_any_project() -> None:
    context = _activated()

    assert asyncio.run(context.fake_queries.invoke("projects.list", {})) == {"items": []}


def test_list_returns_folded_projects_as_items() -> None:
    context = _activated()
    asyncio.run(context.fake_commands.invoke("projects.create", {"title": "写作台"}))
    context.replay()

    assert asyncio.run(context.fake_queries.invoke("projects.list", {})) == {
        "items": context.fake_state.read()["items"]
    }


def test_lookup_returns_id_and_title_of_known_project() -> None:
    context = _activated()
    asyncio.run(context.fake_commands.invoke("projects.create", {"title": "写作台"}))
    context.replay()

    result = asyncio.run(context.fake_services.call("projects.lookup", {"id": "project-1"}))

    assert result == {"id": "project-1", "title": "写作台"}


def test_lookup_rejects_unknown_project_with_value_error() -> None:
    context = _activated()

    with pytest.raises(ValueError):
        asyncio.run(context.fake_services.call("projects.lookup", {"id": "project-9"}))


def test_sidebar_view_passes_c3_schema() -> None:
    nodes = _nodes(_activated())
    schema = _load(ROOT / "protocol" / "c3-node.schema.json")

    assert [node["type"] for node in nodes] == ["Stack"]
    for node in nodes:
        jsonschema.validate(instance=node, schema=schema)


def test_sidebar_lists_project_titles_with_empty_state_text() -> None:
    rows = _children(_nodes(_activated())[0])

    assert [node["type"] for node in rows] == ["Text", "List"]
    assert rows[1]["props"] == {"items": "$items", "emptyText": "还没有项目"}
    row = _children(rows[1])[0]
    assert row["type"] == "Stack"
    assert [leaf["props"]["text"] for leaf in _children(row)] == [
        "$item.title",
        "$item.ideaCountLabel",
    ]


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


def test_idea_assigned_event_shows_up_on_the_project() -> None:
    context = _activated()
    asyncio.run(context.fake_commands.invoke("projects.create", {"title": "写作台"}))
    context.replay()

    asyncio.run(
        context.fake_events.emit(
            "ideas.assigned",
            {
                "id": "idea-1",
                "ideaTitle": "先定素材的粒度",
                "projectId": "project-1",
                "projectTitle": "写作台",
            },
        )
    )
    context.replay()

    items = cast("list[dict[str, object]]", context.fake_state.read()["items"])
    assert items[0]["ideaCountLabel"] == "1 条灵感"
    assert items[0]["ideas"] == [{"id": "idea-1", "title": "先定素材的粒度"}], (
        "别的插件的事件折进了自己的切片,这是跨插件只读共享的唯一方式"
    )


def test_idea_assigned_to_unknown_project_is_ignored() -> None:
    context = _activated()
    asyncio.run(context.fake_commands.invoke("projects.create", {"title": "写作台"}))
    context.replay()

    asyncio.run(
        context.fake_events.emit(
            "ideas.assigned", {"id": "idea-1", "ideaTitle": "x", "projectId": "project-9"}
        )
    )
    context.replay()

    items = cast("list[dict[str, object]]", context.fake_state.read()["items"])
    assert items[0]["ideaCountLabel"] == "0 条灵感", "不认识的项目不该被凭空创建"
