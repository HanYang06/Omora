#!/usr/bin/env python3
"""给本地开发库灌一点像样的数据，方便第一次打开时不是一片空白。

只走公开的 C1 命令，不碰数据库文件。

用法（内核起着时）：
    uv run python scripts/seed_demo.py --url ws://127.0.0.1:8765
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from typing import Any, cast

import websockets
from accept_client import Client, Failure, require

PROJECTS = [
    ("Omora 内核", "把协议、事件与插件宿主打磨到可以托付"),
    ("写作系统", "把散落的笔记收拢成能复用的素材"),
]

REQUIREMENTS = {
    "Omora 内核": [
        ("把插件卸载后的残留清零", "done"),
        ("给插件补上查询能力", "doing"),
    ],
    "写作系统": [("先定素材的粒度", "todo")],
}

IDEAS = [
    ("灵感应该能自动归到项目,而不是每次手动选", "Omora 内核"),
    ("写东西卡住时,缺的往往不是想法而是结构", None),
    ("命令面板也许比侧边栏更重要", "Omora 内核"),
    ("每天只允许自己开一个新项目", None),
]


def count(state: dict[str, Any], plugin_id: str) -> int:
    """数一下某个插件切片里有多少条。"""
    slice_ = state.get(plugin_id)
    if not isinstance(slice_, dict):
        return 0
    items = cast("dict[str, Any]", slice_).get("items")
    return len(cast("list[Any]", items)) if isinstance(items, list) else 0


async def command(client: Client, name: str, args: dict[str, object]) -> dict[str, Any]:
    envelope = await client.call("cmd.invoke", {"name": name, "args": args})
    return cast("dict[str, Any]", envelope.get("result") or {})


async def main_async(url: str) -> int:
    async with websockets.connect(url) as socket:
        client = Client(socket)
        existing = await client.call("query.invoke", {"name": "projects.list", "args": {}})
        if cast("list[object]", existing.get("items", [])):
            print("库里已经有项目了,跳过灌数据(避免重复)。")
            return 0

        project_ids: dict[str, str] = {}
        for title, _ in PROJECTS:
            created = await command(client, "projects.create", {"title": title})
            project_ids[title] = cast("str", created.get("id"))
            require(bool(project_ids[title]), f"创建项目失败: {title}")

        for title, rows in REQUIREMENTS.items():
            for requirement_title, status in rows:
                created = await command(
                    client,
                    "requirements.create",
                    {"title": requirement_title, "projectId": project_ids[title]},
                )
                requirement_id = cast("str", created.get("id"))
                if status != "todo":
                    await command(
                        client,
                        "requirements.setStatus",
                        {"id": requirement_id, "status": status},
                    )

        for idea_title, project_title in IDEAS:
            created = await command(client, "ideas.create", {"title": idea_title})
            if project_title is not None:
                await command(
                    client,
                    "ideas.assign",
                    {"id": cast("str", created.get("id")), "projectId": project_ids[project_title]},
                )

        snapshot = await client.call("state.snapshot", {})
        state = cast("dict[str, Any]", snapshot["state"])
        print(
            "已灌入: "
            f"{count(state, 'omora.projects')} 个项目, "
            f"{count(state, 'omora.requirements')} 条需求, "
            f"{count(state, 'omora.ideas')} 条灵感"
        )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="灌入演示数据")
    parser.add_argument("--url", default="ws://127.0.0.1:8765", help="内核 C1 地址")
    arguments = parser.parse_args()
    try:
        return asyncio.run(main_async(cast("str", arguments.url)))
    except Failure as failure:
        print(f"FAIL {failure}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
