"""C1 传输测试的假实现与客户端工具；只实现窄 Protocol，不碰存储。"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator, Awaitable, Callable, Mapping, Sequence
from contextlib import asynccontextmanager
from typing import cast

from omora_kernel.contract.c1 import Event, Snapshot
from omora_kernel.transport.ws import C1Handlers, C1Server
from websockets.asyncio.client import ClientConnection, connect

InvokeFunction = Callable[[Mapping[str, object]], Awaitable[object]]
RECEIVE_TIMEOUT = 10.0


class FakeSnapshots:
    """可手动推进 revision 的快照来源。"""

    def __init__(self) -> None:
        self.revision = 0
        self.state: dict[str, object] = {}
        self.ui: dict[str, object] = {}

    async def snapshot(self) -> Snapshot:
        return Snapshot(revision=self.revision, state=dict(self.state), ui=dict(self.ui))

    async def current_revision(self) -> int:
        return self.revision


class FakeEventSource:
    """内存事件源；记录监听者，便于断言订阅与退订。"""

    def __init__(self, events: Sequence[Event] = ()) -> None:
        self.events = list(events)
        self.unsubscribed = asyncio.Event()
        self._listeners: list[Callable[[Event], Awaitable[None]]] = []

    def events_since(self, revision: int) -> Sequence[Event]:
        return [event for event in self.events if event.revision > revision]

    def subscribe(self, listener: Callable[[Event], Awaitable[None]]) -> Callable[[], None]:
        self._listeners.append(listener)

        def unsubscribe() -> None:
            self._listeners.remove(listener)
            self.unsubscribed.set()

        return unsubscribe

    async def emit(
        self,
        event_type: str,
        revision: int,
        data: Mapping[str, object] | None = None,
        owner: str | None = None,
        state: Mapping[str, object] | None = None,
    ) -> None:
        event = Event(
            type=event_type,
            revision=revision,
            data=dict(data or {}),
            owner=owner,
            state=dict(state) if state is not None else None,
        )
        for listener in list(self._listeners):
            await listener(event)

    @property
    def listening(self) -> int:
        return len(self._listeners)


class FakeInvoker:
    """同时满足 CommandHandler 与 QueryHandler；按名字分发到测试给的协程。"""

    def __init__(self, handlers: Mapping[str, InvokeFunction] | None = None) -> None:
        self._handlers = dict(handlers or {})
        self.calls: list[tuple[str, Mapping[str, object]]] = []

    async def invoke(self, name: str, args: Mapping[str, object]) -> object:
        self.calls.append((name, dict(args)))
        handler = self._handlers.get(name)
        if handler is None:
            raise ValueError(f"未知命令: {name}")
        return await handler(args)


def make_handlers() -> C1Handlers:
    """全默认假实现：命令/查询未注册时回 E_INVALID。"""
    return C1Handlers(
        commands=FakeInvoker(),
        queries=FakeInvoker(),
        snapshots=FakeSnapshots(),
        events=FakeEventSource(),
    )


@asynccontextmanager
async def connected(handlers: C1Handlers) -> AsyncGenerator[ClientConnection]:
    """在 127.0.0.1 的临时端口启动 C1 服务并连一个客户端。"""
    server = C1Server(handlers)
    await server.start()
    connection = await connect(f"ws://127.0.0.1:{server.port}")
    try:
        yield connection
    finally:
        await connection.close()
        await server.stop()


async def send_request(
    connection: ClientConnection,
    request_id: str | int,
    method: str,
    params: Mapping[str, object],
) -> None:
    await connection.send(
        json.dumps({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})
    )


async def send_raw(connection: ClientConnection, payload: str) -> None:
    await connection.send(payload)


async def receive(connection: ClientConnection) -> dict[str, object]:
    message = await asyncio.wait_for(connection.recv(), timeout=RECEIVE_TIMEOUT)
    return cast("dict[str, object]", json.loads(message))
