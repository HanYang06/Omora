#!/usr/bin/env python3
"""P1 验收脚本：跑通「捕捉 → 分诊 → 建需求 → 改状态」的完整链路。

只依赖协议，不 import 内核；内核用 `uv run python -m omora_kernel` 起在另一个进程。

用法：
    uv run python scripts/accept_p1.py --url ws://127.0.0.1:8765
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from typing import Any, cast

import websockets
from accept_client import Client, Failure, require

PROJECT_TITLE = "Omora P1"


async def command(client: Client, name: str, args: dict[str, object]) -> dict[str, Any]:
    """执行命令并取出内核给的 result。"""
    envelope = await client.call("cmd.invoke", {"name": name, "args": args})
    return cast("dict[str, Any]", envelope.get("result") or {})


def items_of(state: dict[str, Any], plugin_id: str) -> list[dict[str, Any]]:
    slice_ = state.get(plugin_id)
    if not isinstance(slice_, dict):
        return []
    items = cast("dict[str, Any]", slice_).get("items")
    return cast("list[dict[str, Any]]", items) if isinstance(items, list) else []


async def check_commands(client: Client, snapshot: dict[str, Any]) -> None:
    """前提：命令面板要用的命令清单已经在快照里。"""
    described = cast(
        "list[dict[str, Any]]", cast("dict[str, Any]", snapshot["ui"]).get("commands", [])
    )
    identifiers = {entry.get("id") for entry in described}
    needed = {"projects.create", "requirements.create", "requirements.setStatus", "ideas.assign"}
    require(needed <= identifiers, f"快照里缺少命令: {sorted(needed - identifiers)}")
    print("PASS 前提: 快照下发了命令清单")


async def check_loop(client: Client) -> None:
    """主链路：建项目 → 建需求 → 改状态 → 记灵感 → 分诊。"""
    project = await command(client, "projects.create", {"title": PROJECT_TITLE})
    project_id = cast("str", project.get("id"))
    require(bool(project_id), "projects.create 没有返回 id")

    requirement = await command(
        client, "requirements.create", {"title": "把 P1 跑通", "projectId": project_id}
    )
    requirement_id = cast("str", requirement.get("id"))
    await command(client, "requirements.setStatus", {"id": requirement_id, "status": "doing"})

    idea = await command(client, "ideas.create", {"title": "验收脚本的灵感"})
    idea_id = cast("str", idea.get("id"))
    await command(client, "ideas.assign", {"id": idea_id, "projectId": project_id})
    print("PASS 链路: 项目 → 需求 → 状态 → 灵感 → 分诊 全部执行成功")

    snapshot = await client.call("state.snapshot", {})
    state = cast("dict[str, Any]", snapshot["state"])

    projects = items_of(state, "omora.projects")
    require(
        any(item.get("id") == project_id for item in projects), "项目没有出现在 projects 切片里"
    )

    requirements = items_of(state, "omora.requirements")
    target = [item for item in requirements if item.get("id") == requirement_id]
    require(bool(target), "需求没有出现在 requirements 切片里")
    require(target[0].get("status") == "doing", "需求状态没有流转到 doing")

    ideas = items_of(state, "omora.ideas")
    linked = [item for item in ideas if item.get("id") == idea_id]
    require(bool(linked), "灵感没有出现在 ideas 切片里")
    require(linked[0].get("projectTitle") == PROJECT_TITLE, "分诊后没有带上项目名")
    print("PASS 投影: 三个插件的切片都反映了这次操作,分诊带上了项目名")


async def check_slots(client: Client) -> None:
    """验收：三个插件各自往自己的槽位填了内容。"""
    snapshot = await client.call("state.snapshot", {})
    slots = cast("dict[str, Any]", cast("dict[str, Any]", snapshot["ui"])["slots"])
    sidebar = cast("list[dict[str, Any]]", slots.get("sidebar", []))
    main = cast("list[dict[str, Any]]", slots.get("main", []))
    sidebar_owners = {entry.get("owner") for entry in sidebar}
    main_owners = {entry.get("owner") for entry in main}
    require("omora.projects" in sidebar_owners, f"sidebar 缺少项目插件的贡献: {sidebar_owners}")
    require("omora.requirements" in main_owners, f"main 缺少需求插件的贡献: {main_owners}")
    print("PASS 槽位: 项目在 sidebar,需求在 main")


async def check_query(client: Client) -> None:
    """验收：插件注册的查询能通过 query.invoke 调用。"""
    result = await client.call("query.invoke", {"name": "projects.list", "args": {}})
    items = cast("list[dict[str, Any]]", result.get("items", []))
    require(bool(items), "projects.list 没有返回条目")
    print(f"PASS 查询: projects.list 返回 {len(items)} 个项目")


async def check_isolation(client: Client) -> None:
    """验收：未知命令必须被明确拒绝，而不是静默成功。"""
    try:
        await client.call("cmd.invoke", {"name": "does.not.exist", "args": {}})
    except Failure as failure:
        require("E_UNAVAILABLE" in str(failure), f"未知命令的错误码不对: {failure}")
        print("PASS 隔离: 未知命令以 E_UNAVAILABLE 拒绝")
        return
    raise Failure("未知命令竟然成功了")


async def main_async(url: str) -> int:
    async with websockets.connect(url) as socket:
        client = Client(socket)
        snapshot = await client.call("state.snapshot", {})
        await check_commands(client, snapshot)
        await check_isolation(client)
        await check_loop(client)
        await check_slots(client)
        await check_query(client)
    print("\nP1 验收通过。")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Omora P1 验收")
    parser.add_argument("--url", default="ws://127.0.0.1:8765", help="内核 C1 地址")
    arguments = parser.parse_args()
    try:
        return asyncio.run(main_async(cast("str", arguments.url)))
    except Failure as failure:
        print(f"FAIL {failure}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
