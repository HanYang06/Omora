"""每连接的发送队列：订阅表、有界队列、coalesce、overloaded 与发送任务。

回帧优先于 event：队列满时先丢最老的待发 event；只有队列里全是
没送出去的回帧（客户端没在读）才把回帧换成 overloaded。
net.py 只负责生命周期、分发与装配。
"""

from __future__ import annotations

import asyncio
import json
from collections import deque
from collections.abc import Awaitable, Callable
from typing import Any

from websockets.asyncio.server import ServerConnection
from websockets.exceptions import ConnectionClosed

from omora.sdk.protocol import EVENT, OVERLOADED, error_frame, event_frame

DEFAULT_QUEUE_MAX = 256
OVERLOADED_MESSAGE = "发送队列已满（客户端没在读）；调用可能已经执行过，重试要幂等"

Frame = dict[str, Any]
Writer = Callable[[ServerConnection, str], Awaitable[None]]


class Counters:
    """发送与丢弃计数：跨连接累计，连接断开也不清零。"""

    def __init__(self) -> None:
        self.frames_out = 0
        self.bytes_out = 0
        self.dropped = 0


class Outbox:
    """一条连接自己的订阅表与发送队列。断开即随对象一起消失。"""

    def __init__(self, ws: ServerConnection, *, max_queue: int, counters: Counters) -> None:
        self.ws = ws
        self.max_queue = max_queue
        self.counters = counters
        self.topics: dict[str, None] = {}
        self.queue: deque[Frame] = deque()
        self.wakeup = asyncio.Event()
        self.sending: Frame | None = None
        self.closed = False

    # ---- 订阅 ----

    def topic_list(self) -> list[str]:
        return list(self.topics)

    def wants(self, topic: str) -> bool:
        return topic in self.topics

    def subscribe(self, names: list[str]) -> None:
        for name in names:
            self.topics.setdefault(name, None)

    def unsubscribe(self, names: list[str]) -> None:
        for name in names:
            self.topics.pop(name, None)

    # ---- 入队 ----

    def push_event(self, topic: str, payload: dict[str, Any], coalesce: bool) -> bool:
        """入队一条 event；返回是否因为放不下而丢弃（由调用方记 dropped 日志）。"""
        frame = event_frame(topic, payload)
        if coalesce:
            for index, queued in enumerate(self.queue):
                if (
                    queued.get("type") == EVENT
                    and queued.get("topic") == topic
                    and queued is not self.sending
                ):
                    self.queue[index] = frame
                    self.wakeup.set()
                    return False
        if len(self.queue) >= self.max_queue:
            self.counters.dropped += 1
            return True
        self.queue.append(frame)
        self.wakeup.set()
        return False

    def enqueue_reply(self, frame: Frame) -> None:
        # 回帧优先于 event：满了先丢最老的待发 event；丢不出来才说明客户端没在读。
        if len(self.queue) >= self.max_queue:
            self._drop_oldest_event()
        if len(self.queue) >= self.max_queue and frame["id"] is not None:
            frame = error_frame(frame["id"], OVERLOADED, OVERLOADED_MESSAGE)
        self.queue.append(frame)
        self.wakeup.set()

    def _drop_oldest_event(self) -> None:
        for index, queued in enumerate(self.queue):
            if queued.get("type") == EVENT and queued is not self.sending:
                del self.queue[index]
                self.counters.dropped += 1
                return

    # ---- 发送 ----

    async def run(self, writer: Writer) -> None:
        """每连接一条发送任务：按入队顺序把帧写出去。"""
        while not self.closed:
            await self.wakeup.wait()
            self.wakeup.clear()
            while self.queue and not self.closed:
                frame = self.queue[0]
                self.sending = frame
                text = json.dumps(frame, ensure_ascii=False)
                try:
                    await writer(self.ws, text)
                except ConnectionClosed:
                    self.closed = True
                    return
                finally:
                    self.sending = None
                if self.queue and self.queue[0] is frame:
                    self.queue.popleft()
                self.counters.frames_out += 1
                # 算字节数，不是再发一次。
                self.counters.bytes_out += len(text.encode("utf-8"))


__all__ = ["DEFAULT_QUEUE_MAX", "Counters", "Frame", "Outbox", "Writer"]
