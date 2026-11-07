"""ideas 插件的行为测试:登记、事件载荷、状态折叠与视图。"""

from __future__ import annotations

import asyncio
import copy
from typing import cast

import jsonschema
from omora_sdk import Node
from support import NOW, ROOT, _activated, _find, _load, _manifest


def test_activate_registers_commands_contribution_and_reducers() -> None:
    context = _activated()

    assert set(context.fake_commands.handlers) == {
        "ideas.create",
        "ideas.archive",
        "ideas.assign",
    }
    assert set(context.fake_ui.contributions) == {"ideas.sidebar"}
    assert set(context.fake_state.reducers) == {
        "ideas.created",
        "ideas.archived",
        "ideas.assigned",
    }


def test_create_emits_created_event_with_title_and_injected_id() -> None:
    context = _activated()

    asyncio.run(context.fake_commands.invoke("ideas.create", {"title": "把协议写下来"}))

    assert context.fake_events.emitted == [
        ("ideas.created", {"id": "idea-1", "title": "把协议写下来", "at": NOW.isoformat()})
    ]


def test_create_ids_follow_injected_sequence() -> None:
    context = _activated()

    asyncio.run(context.fake_commands.invoke("ideas.create", {"title": "第一"}))
    asyncio.run(context.fake_commands.invoke("ideas.create", {"title": "第二"}))

    assert [data["id"] for _event, data in context.fake_events.emitted] == ["idea-1", "idea-2"]


def test_created_event_folds_into_items() -> None:
    context = _activated()

    asyncio.run(context.fake_commands.invoke("ideas.create", {"title": "写协议"}))
    context.replay()

    assert context.fake_state.read() == {
        "items": [{"id": "idea-1", "title": "写协议", "at": NOW.isoformat()}]
    }


def test_archived_event_removes_only_that_item() -> None:
    context = _activated()
    asyncio.run(context.fake_commands.invoke("ideas.create", {"title": "保留"}))
    asyncio.run(context.fake_commands.invoke("ideas.create", {"title": "归档"}))
    context.replay()

    asyncio.run(context.fake_commands.invoke("ideas.archive", {"id": "idea-2"}))
    assert context.fake_events.emitted[-1] == ("ideas.archived", {"id": "idea-2"})
    context.replay()

    assert context.fake_state.read() == {
        "items": [{"id": "idea-1", "title": "保留", "at": NOW.isoformat()}]
    }


def test_unknown_event_leaves_items_unchanged() -> None:
    context = _activated()
    asyncio.run(context.fake_commands.invoke("ideas.create", {"title": "写协议"}))
    context.replay()
    before = copy.deepcopy(context.fake_state.read())

    asyncio.run(context.fake_events.emit("ideas.renamed", {"id": "idea-1", "title": "改名"}))
    context.replay()

    assert context.fake_state.read() == before


def test_sidebar_view_passes_c3_schema() -> None:
    context = _activated()
    view = context.fake_ui.contributions["ideas.sidebar"]

    nodes: list[Node] = list(view(context.fake_state.read()))

    assert [node["type"] for node in nodes] == ["Stack"]
    schema = _load(ROOT / "protocol" / "c3-node.schema.json")
    for node in nodes:
        jsonschema.validate(instance=node, schema=schema)


def test_sidebar_input_passes_typed_text_as_title() -> None:
    context = _activated()
    view = context.fake_ui.contributions["ideas.sidebar"]

    inputs = _find(list(view(context.fake_state.read())), "Input")

    assert len(inputs) == 1
    actions = cast("dict[str, object]", inputs[0]["on"])
    assert actions["submit"] == {"command": "ideas.create", "args": {"title": "$value"}}


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
