"""ideas 的分诊:先问 projects 服务,再发归属事件;服务不可用时不留下事件。"""

from __future__ import annotations

import asyncio
from typing import cast

import pytest
from support import activated


def test_assign_asks_projects_service_and_emits_event() -> None:
    context = activated()
    asyncio.run(context.fake_commands.invoke("ideas.create", {"title": "写协议"}))
    context.replay()
    context.fake_services.replies["projects.lookup"] = {"id": "p1", "title": "Omora"}

    asyncio.run(context.fake_commands.invoke("ideas.assign", {"id": "idea-1", "projectId": "p1"}))

    assert context.fake_services.calls == [("projects.lookup", {"id": "p1"})], (
        "分诊前必须向 projects 服务确认项目存在"
    )
    assert context.fake_events.emitted[-1] == (
        "ideas.assigned",
        {
            "id": "idea-1",
            "ideaTitle": "写协议",
            "projectId": "p1",
            "projectTitle": "Omora",
        },
    ), "事件里要带上灵感标题,别的插件才能展示它"


def test_assigned_event_folds_project_into_item() -> None:
    context = activated()
    asyncio.run(context.fake_commands.invoke("ideas.create", {"title": "写协议"}))
    context.fake_services.replies["projects.lookup"] = {"id": "p1", "title": "Omora"}
    asyncio.run(context.fake_commands.invoke("ideas.assign", {"id": "idea-1", "projectId": "p1"}))
    context.replay()

    items = cast("list[dict[str, object]]", context.fake_state.read()["items"])
    assert items[0]["projectId"] == "p1"
    assert items[0]["projectTitle"] == "Omora"


def test_assign_emits_nothing_when_service_is_unavailable() -> None:
    context = activated()

    with pytest.raises(RuntimeError):
        asyncio.run(
            context.fake_commands.invoke("ideas.assign", {"id": "idea-1", "projectId": "p1"})
        )

    assert context.fake_events.emitted == [], "服务不可用时不能留下归属事件"
