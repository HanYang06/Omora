"""验收脚本共用的 C1 客户端：按 id 认响应，把通知攒进队列。

命令在 handler 里发事件时，通知帧可能先于响应帧到达，所以不能假设"下一帧就是响应"。
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, cast

from websockets.asyncio.client import ClientConnection

TIMEOUT = 5.0


class Failure(AssertionError):
    """验收未通过。"""


class Client:
    def __init__(self, socket: ClientConnection) -> None:
        self._socket = socket
        self._notifications: list[dict[str, Any]] = []
        self._next_id = 1

    async def call(self, method: str, params: dict[str, object]) -> dict[str, Any]:
        request_id = self._next_id
        self._next_id += 1
        frame = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
        await self._socket.send(json.dumps(frame))
        while True:
            received = await self._receive()
            if "error" in received:
                error = cast("dict[str, Any]", received["error"])
                raise Failure(f"{method} 失败: {error.get('code')} {error.get('message')}")
            if received.get("id") == request_id:
                return cast("dict[str, Any]", received.get("result", {}))

    async def next_event(self) -> dict[str, Any]:
        while not self._notifications:
            await self._receive()
        return self._notifications.pop(0)

    async def _receive(self) -> dict[str, Any]:
        raw = await asyncio.wait_for(self._socket.recv(), TIMEOUT)
        frame = cast("dict[str, Any]", json.loads(raw))
        if frame.get("method") == "event":
            self._notifications.append(cast("dict[str, Any]", frame["params"]))
        return frame


def require(condition: bool, message: str) -> None:
    if not condition:
        raise Failure(message)
