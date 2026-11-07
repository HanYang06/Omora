"""requirements 跟随 projects 的聚焦事件过滤列表,并拒绝空标题。"""

from __future__ import annotations

import asyncio
from typing import cast

import pytest
from omora_plugins_requirements import plugin
from requirements_fakes import FakeContext


def _activated() -> FakeContext:
    context = FakeContext()
    asyncio.run(plugin.activate(context))
    return context


def _create(context: FakeContext, title: str, project_id: str) -> object:
    return asyncio.run(
        context.fake_commands.invoke(
            "requirements.create", {"title": title, "projectId": project_id}
        )
    )


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


def test_create_rejects_blank_title() -> None:
    context = _activated()

    with pytest.raises(ValueError):
        asyncio.run(context.fake_commands.invoke("requirements.create", {"title": ""}))

    assert context.fake_events.emitted == [], "空标题不该产生任何事件"
