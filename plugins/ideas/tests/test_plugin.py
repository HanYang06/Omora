"""ideas 插件的行为测试:登记、事件载荷、状态折叠与视图。"""

from __future__ import annotations

import asyncio
import copy
from typing import cast

import jsonschema
import pytest
from omora_sdk import Node
from support import NOW, ROOT, activated, find_nodes, load_json, manifest


def test_activate_registers_commands_contribution_and_reducers() -> None:
    context = activated()

    assert set(context.fake_commands.handlers) == {
        "ideas.create",
        "ideas.archive",
        "ideas.assign",
    }
    assert set(context.fake_ui.contributions) == {"ideas.capture", "ideas.inbox"}
    assert set(context.fake_state.reducers) == {
        "ideas.created",
        "ideas.archived",
        "ideas.assigned",
    }


def test_create_emits_created_event_with_title_and_injected_id() -> None:
    context = activated()

    asyncio.run(context.fake_commands.invoke("ideas.create", {"title": "把协议写下来"}))

    assert context.fake_events.emitted == [
        ("ideas.created", {"id": "idea-1", "title": "把协议写下来", "at": NOW.isoformat()})
    ]


def test_create_ids_follow_injected_sequence() -> None:
    context = activated()

    asyncio.run(context.fake_commands.invoke("ideas.create", {"title": "第一"}))
    asyncio.run(context.fake_commands.invoke("ideas.create", {"title": "第二"}))

    assert [data["id"] for _event, data in context.fake_events.emitted] == ["idea-1", "idea-2"]


def test_created_event_folds_into_items() -> None:
    context = activated()

    asyncio.run(context.fake_commands.invoke("ideas.create", {"title": "写协议"}))
    context.replay()

    assert context.fake_state.read() == {
        "items": [
            {
                "id": "idea-1",
                "title": "写协议",
                "at": NOW.isoformat(),
                "atLabel": "04-05 06:07",
                "projectTitle": "",
            }
        ]
    }


def test_archived_event_removes_only_that_item() -> None:
    context = activated()
    asyncio.run(context.fake_commands.invoke("ideas.create", {"title": "保留"}))
    asyncio.run(context.fake_commands.invoke("ideas.create", {"title": "归档"}))
    context.replay()

    asyncio.run(context.fake_commands.invoke("ideas.archive", {"id": "idea-2"}))
    assert context.fake_events.emitted[-1] == ("ideas.archived", {"id": "idea-2"})
    context.replay()

    items = cast("list[dict[str, object]]", context.fake_state.read()["items"])
    assert [item["title"] for item in items] == ["保留"]


def test_unknown_event_leaves_items_unchanged() -> None:
    context = activated()
    asyncio.run(context.fake_commands.invoke("ideas.create", {"title": "写协议"}))
    context.replay()
    before = copy.deepcopy(context.fake_state.read())

    asyncio.run(context.fake_events.emit("ideas.renamed", {"id": "idea-1", "title": "改名"}))
    context.replay()

    assert context.fake_state.read() == before


def test_sidebar_view_passes_c3_schema() -> None:
    context = activated()
    view = context.fake_ui.contributions["ideas.inbox"]

    nodes: list[Node] = list(view(context.fake_state.read()))

    assert [node["type"] for node in nodes] == ["Stack"]
    schema = load_json(ROOT / "protocol" / "c3-node.schema.json")
    for node in nodes:
        jsonschema.validate(instance=node, schema=schema)


def test_sidebar_input_passes_typed_text_as_title() -> None:
    context = activated()
    view = context.fake_ui.contributions["ideas.capture"]

    inputs = find_nodes(list(view(context.fake_state.read())), "Input")

    assert len(inputs) == 1
    actions = cast("dict[str, object]", inputs[0]["on"])
    assert actions["submit"] == {"command": "ideas.create", "args": {"title": "$value"}}


def test_registered_commands_and_slots_matchmanifest() -> None:
    context = activated()
    payload = manifest()

    declared_commands = {entry["id"] for entry in payload["contributes"]["commands"]}
    declared_slots = {entry["id"] for entry in payload["contributes"]["slots"]}

    assert set(context.fake_commands.handlers) == declared_commands
    assert set(context.fake_ui.contributions) == declared_slots


def test_manifest_passes_c2_schema() -> None:
    jsonschema.validate(
        instance=manifest(), schema=load_json(ROOT / "protocol" / "c2-manifest.schema.json")
    )


def test_manifest_version_matches_repository_version() -> None:
    expected = (ROOT / "VERSION").read_text(encoding="utf-8").strip()

    assert manifest()["version"] == expected


def test_create_rejects_blank_title() -> None:
    context = activated()

    with pytest.raises(ValueError):
        asyncio.run(context.fake_commands.invoke("ideas.create", {"title": "   "}))

    assert context.fake_events.emitted == [], "空标题不该产生任何事件"
