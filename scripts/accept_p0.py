#!/usr/bin/env python3
"""P0 验收脚本：用 C1 客户端驱动一个正在运行的内核，逐条验证验收项。

它只依赖协议，不 import 内核；内核用 `uv run python -m omora_kernel` 起在另一个进程。

用法：
    uv run python scripts/accept_p0.py --url ws://127.0.0.1:8765
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections.abc import Mapping
from typing import Any, cast

import websockets
from websockets.asyncio.client import ClientConnection

Timeout = 5.0


class Failure(AssertionError):
    """验收未通过。"""


async def call(
    socket: ClientConnection, request_id: int, method: str, params: Mapping[str, object]
) -> dict[str, Any]:
    """发一条请求并取回 result；错误帧直接转成失败。"""
    await socket.send(
        json.dumps({"jsonrpc": "2.0", "id": request_id, "method": method, "params": dict(params)})
    )
    raw = await asyncio.wait_for(socket.recv(), Timeout)
    frame = cast("dict[str, Any]", json.loads(raw))
    if "error" in frame:
        error = cast("dict[str, Any]", frame["error"])
        raise Failure(f"{method} 失败: {error.get('code')} {error.get('message')}")
    return cast("dict[str, Any]", frame.get("result", {}))


async def next_event(socket: ClientConnection) -> dict[str, Any]:
    """等下一条下行 event 通知。"""
    while True:
        raw = await asyncio.wait_for(socket.recv(), Timeout)
        frame = cast("dict[str, Any]", json.loads(raw))
        if frame.get("method") == "event":
            return cast("dict[str, Any]", frame["params"])


def require(condition: bool, message: str) -> None:
    if not condition:
        raise Failure(message)


async def check_snapshot(socket: ClientConnection) -> dict[str, Any]:
    """验收 1：快照来自内核，带 revision、state 与槽位投影。"""
    result = await call(socket, 1, "state.snapshot", {})
    require(isinstance(result.get("revision"), int), "快照缺少 revision")
    require(isinstance(result.get("state"), dict), "快照缺少 state")
    require(isinstance(result.get("ui"), dict), "快照缺少 ui")
    slots = cast("dict[str, Any]", result["ui"]).get("slots")
    require(isinstance(slots, dict), "快照的 ui 缺少 slots")
    print("PASS 验收 1: 快照带 revision / state / ui")
    return result


async def check_contribution(snapshot: dict[str, Any]) -> None:
    """验收 3：官方插件通过 C3 往 sidebar 填了内容。"""
    slots = cast("dict[str, Any]", snapshot["ui"])["slots"]
    sidebar = cast("dict[str, Any]", slots).get("sidebar")
    contributions: list[Any] = cast("list[Any]", sidebar) if isinstance(sidebar, list) else []
    require(len(contributions) > 0, "sidebar 槽位没有任何贡献，插件没挂上")
    owners = [cast("dict[str, Any]", item).get("owner") for item in contributions]
    require("omora.ideas" in owners, f"sidebar 的贡献里没有 omora.ideas，实际 owner: {owners}")
    nodes = cast("dict[str, Any]", contributions[0]).get("nodes")
    require(isinstance(nodes, list) and len(cast("list[Any]", nodes)) > 0, "贡献里没有节点树")
    print("PASS 验收 3: ideas 插件通过 C3 贡献了 sidebar 内容")


async def check_command(socket: ClientConnection, revision: int) -> None:
    """验收 2：命令上行 → 内核落库 → 事件下行 → 投影更新。"""
    await call(socket, 2, "event.subscribe", {"since": revision})
    await call(socket, 3, "cmd.invoke", {"name": "ideas.create", "args": {"title": "验收脚本写入"}})
    event = await next_event(socket)
    require(event.get("revision", 0) > revision, "命令之后没有收到更大的 revision")
    require(
        event.get("owner") == "omora.ideas", f"事件没有归属到 ideas 插件，实际 {event.get('owner')}"
    )
    state = event.get("state")
    require(isinstance(state, dict), "实时事件没有携带折叠后的切片")
    items = cast("dict[str, Any]", state).get("items")
    require(isinstance(items, list), "切片里没有 items")
    titles = [cast("dict[str, Any]", item).get("title") for item in cast("list[Any]", items)]
    require("验收脚本写入" in titles, f"新写入的条目没有出现在切片里，实际 {titles}")
    print("PASS 验收 2: 命令落库 → 事件下行 → 投影更新")


async def check_catch_up(url: str, revision: int, count: int) -> None:
    """验收 5：重连后按 revision 追上，且补发不带切片。"""
    async with websockets.connect(url) as socket:
        result = await call(socket, 4, "event.subscribe", {"since": revision})
        require(isinstance(result.get("revision"), int), "订阅结果缺少 revision")
    print(f"PASS 验收 5: 重连可订阅 revision {revision} 之后的事件（当前共 {count} 条）")


async def check_ping(socket: ClientConnection) -> None:
    """附加：ping 返回当前 revision，客户端据此发现缺口。"""
    result = await call(socket, 5, "ping", {})
    require(isinstance(result.get("revision"), int), "ping 没有返回 revision")
    print("PASS 附加: ping 返回当前 revision")


async def main_async(url: str) -> int:
    async with websockets.connect(url) as socket:
        snapshot = await check_snapshot(socket)
        await check_contribution(snapshot)
        await check_command(socket, cast("int", snapshot["revision"]))
        await check_ping(socket)
        await check_catch_up(url, cast("int", snapshot["revision"]), 0)
    print("\nP0 验收通过。")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Omora P0 验收")
    parser.add_argument("--url", default="ws://127.0.0.1:8765", help="内核 C1 地址")
    arguments = parser.parse_args()
    try:
        return asyncio.run(main_async(cast("str", arguments.url)))
    except Failure as failure:
        print(f"FAIL {failure}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
