"""推送：插件把事件交给 net。

内核不认识帧，也不认识推送；这里只是把 `ctx.resolve("net")` 包一层，
免得每个要推送的插件都重复 try / except。取不到 net 就丢弃：
本地只有一个客户端，没有连接就等于没人听。

只用结构化类型，不 import 内核：SDK 里除了 `__init__` 不该多一处对内核的依赖。
"""

from __future__ import annotations

from typing import Any, Protocol


class Resolver(Protocol):
    """只要能从名字拿到服务，就是 `emit` 要的上下文。"""

    def resolve(self, name: str) -> Any: ...


def emit(ctx: Resolver, topic: str, payload: dict[str, Any], *, coalesce: bool = False) -> None:
    """把一帧 event 交给 net；net 没装就什么也不做。"""
    try:
        net: Any = ctx.resolve("net")
    except LookupError:
        return
    net.emit(topic, payload, coalesce=coalesce)
