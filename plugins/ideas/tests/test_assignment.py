"""ideas 的分诊:先问 projects 服务,再发归属事件;服务不可用时不留下事件。"""

from __future__ import annotations

import asyncio
from typing import cast

import pytest
from support import _activated


def test_assign_asks_projects_service_and_emits_event() -> None:
    context = _activated()
    context.fake_services.replies["projects.lookup"] = {"id": "p1", "title": "Omora"}

    asyncio.run(context.fake_commands.invoke("ideas.assign", {"id": "idea-1", "projectId": "p1"}))

    assert context.fake_services.calls == [("projects.lookup", {"id": "p1"})], (
        "分诊前必须向 projects 服务确认项目存在"
    )
    assert context.fake_events.emitted == [
        ("ideas.assigned", {"id": "idea-1", "projectId": "p1", "projectTitle": "Omora"})
    ]


def test_assigned_event_folds_project_into_item() -> None:
    context = _activated()
    asyncio.run(context.fake_commands.invoke("ideas.create", {"title": "写协议"}))
    context.fake_services.replies["projects.lookup"] = {"id": "p1", "title": "Omora"}
    asyncio.run(context.fake_commands.invoke("ideas.assign", {"id": "idea-1", "projectId": "p1"}))
    context.replay()

    items = cast("list[dict[str, object]]", context.fake_state.read()["items"])
    assert items[0]["projectId"] == "p1"
    assert items[0]["projectTitle"] == "Omora"


def test_assign_emits_nothing_when_service_is_unavailable() -> None:
    context = _activated()

    with pytest.raises(RuntimeError):
        asyncio.run(
            context.fake_commands.invoke("ideas.assign", {"id": "idea-1", "projectId": "p1"})
        )

    assert context.fake_events.emitted == [], "服务不可用时不能留下归属事件"
