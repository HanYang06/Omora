"""C1 契约面：传输层只依赖这里的窄 Protocol，不依赖存储与事件日志实现。

命令、查询、快照、事件来源都可能有不同实现；传输层只按本文件的结构说话。
入站请求帧的校验也在这里完成，规则逐条对应 protocol/c1-frames.schema.json。
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol, cast


@dataclass(frozen=True, slots=True)
class Event:
    """一条下行事件。revision 单调递增，客户端据此去重与断线追赶。

    owner 与 state 只出现在实时推送里：owner 是这条事件折叠进的插件切片，
    state 是折叠后的完整切片，客户端整体替换即可，不需要懂业务规则。
    补发与追赶不带这两项，重连一律先取快照。
    """

    type: str
    revision: int
    data: Mapping[str, object]
    owner: str | None = None
    state: Mapping[str, object] | None = None


class CommandHandler(Protocol):
    """执行命令；失败用异常表达（UnavailableError / ValueError / 其他）。"""

    async def invoke(self, name: str, args: Mapping[str, object]) -> object: ...


class QueryHandler(Protocol):
    """执行只读查询；返回值必须是 QueryResult 形状的映射（items + 可选 cursor）。"""

    async def invoke(self, name: str, args: Mapping[str, object]) -> object: ...


@dataclass(frozen=True, slots=True)
class Snapshot:
    """全量快照：revision、投影 state 与 UI 槽位投影 ui，后两者对 C1 不透明。"""

    revision: int
    state: Mapping[str, object]
    ui: Mapping[str, object]


class SnapshotProvider(Protocol):
    """提供全量快照与当前 revision。"""

    async def snapshot(self) -> Snapshot: ...

    async def current_revision(self) -> int: ...


class EventSource(Protocol):
    """事件来源：按 revision 追赶，并支持注册监听。"""

    def events_since(self, revision: int) -> Sequence[Event]:
        """返回 revision 严格大于给定值的事件，按 revision 升序。"""
        ...

    def subscribe(self, listener: Callable[[Event], Awaitable[None]]) -> Callable[[], None]:
        """注册监听并返回取消函数；监听可能被事件源并发调用。"""
        ...


class InvalidFrameError(ValueError):
    """入站帧不符合 C1 schema；语义对应错误码 E_INVALID。"""

    code: str = "E_INVALID"


@dataclass(frozen=True, slots=True)
class RequestFrame:
    """通过校验的请求帧；服务端只处理 Request 形状。"""

    id: str | int
    method: str
    params: Mapping[str, object]


ParamsValidator = Callable[[Mapping[str, object]], None]

_FRAME_KEYS = frozenset({"jsonrpc", "id", "method", "params"})


def extract_request_id(payload: object) -> str | int | None:
    """从任意已解析载荷里尽力取出请求 id；取不到或类型不合法时返回 None。"""
    if not isinstance(payload, Mapping):
        return None
    entries = cast("Mapping[object, object]", payload)
    return _request_id(entries.get("id"))


def validate_request_frame(payload: object) -> RequestFrame:
    """按 C1 帧 schema 的 Request 形状校验入站帧。

    只接受带 id 的请求；通知与响应不是服务端入站语义。校验失败抛
    InvalidFrameError（E_INVALID），调用方据此回错误帧而不是断开连接。
    """
    if not isinstance(payload, Mapping):
        raise InvalidFrameError("帧必须是 JSON 对象")
    frame = cast("Mapping[str, object]", payload)
    if frame.get("jsonrpc") != "2.0":
        raise InvalidFrameError("jsonrpc 必须是 2.0")
    if "id" not in frame:
        raise InvalidFrameError("请求必须带 id")
    request_id = _request_id(frame.get("id"))
    if request_id is None:
        raise InvalidFrameError("id 必须是字符串或整数")
    method = frame.get("method")
    if not isinstance(method, str) or not method:
        raise InvalidFrameError("method 必须是非空字符串")
    params = frame.get("params")
    if not isinstance(params, Mapping):
        raise InvalidFrameError("params 必须是对象")
    unknown = set(frame) - _FRAME_KEYS
    if unknown:
        raise InvalidFrameError(f"帧含未知字段: {sorted(unknown)}")
    validate = _PARAMS_VALIDATORS.get(method)
    if validate is None:
        raise InvalidFrameError(f"未知方法: {method}")
    validate(cast("Mapping[str, object]", params))
    return RequestFrame(id=request_id, method=method, params=cast("Mapping[str, object]", params))


def as_query_result(raw: object) -> dict[str, object]:
    """把 QueryHandler 的返回值收敛成 QueryResult 形状。

    形状不符是宿主缺陷：抛 RuntimeError（传输层映射为 E_INTERNAL），不向客户端
    暴露 handler 的返回值细节。
    """
    if not isinstance(raw, Mapping):
        raise RuntimeError("query.invoke 必须返回 {items, cursor?}")
    page = cast("Mapping[str, object]", raw)
    items = page.get("items")
    if not isinstance(items, list):
        raise RuntimeError("query.invoke 返回缺少 items 数组")
    result: dict[str, object] = {"items": items}
    if "cursor" in page:
        cursor = page["cursor"]
        if not (cursor is None or isinstance(cursor, str) or _is_integer(cursor)):
            raise RuntimeError("query.invoke 返回的 cursor 形状不合法")
        result["cursor"] = cursor
    return result


def _request_id(value: object) -> str | int | None:
    if isinstance(value, str):
        return value
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return None


def _is_integer(value: object) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return True
    return isinstance(value, float) and value.is_integer()


def _reject_unknown(params: Mapping[str, object], allowed: tuple[str, ...], where: str) -> None:
    unknown = set(params) - set(allowed)
    if unknown:
        raise InvalidFrameError(f"{where}含未知字段: {sorted(unknown)}")


def _require_name(params: Mapping[str, object]) -> None:
    name = params.get("name")
    if not isinstance(name, str) or not name:
        raise InvalidFrameError("name 必须是非空字符串")


def _validate_args(params: Mapping[str, object]) -> None:
    if "args" in params and not isinstance(params["args"], Mapping):
        raise InvalidFrameError("args 必须是对象")


def _validate_limit(value: object) -> None:
    if not _is_integer(value):
        raise InvalidFrameError("limit 必须是整数")
    limit = cast("int | float", value)
    if limit < 1 or limit > 500:
        raise InvalidFrameError("limit 必须在 1 到 500 之间")


def _validate_snapshot_params(params: Mapping[str, object]) -> None:
    _reject_unknown(params, (), "state.snapshot 参数")


def _validate_ping_params(params: Mapping[str, object]) -> None:
    _reject_unknown(params, (), "ping 参数")


def _validate_cmd_params(params: Mapping[str, object]) -> None:
    _reject_unknown(params, ("name", "args", "idempotencyKey"), "cmd.invoke 参数")
    _require_name(params)
    _validate_args(params)
    if "idempotencyKey" not in params:
        return
    key = params["idempotencyKey"]
    if not isinstance(key, str) or len(key) < 8:
        raise InvalidFrameError("idempotencyKey 必须是至少 8 个字符的字符串")


def _validate_query_params(params: Mapping[str, object]) -> None:
    _reject_unknown(params, ("name", "args", "cursor", "limit"), "query.invoke 参数")
    _require_name(params)
    _validate_args(params)
    if "cursor" in params:
        cursor = params["cursor"]
        if not (cursor is None or isinstance(cursor, str) or _is_integer(cursor)):
            raise InvalidFrameError("cursor 必须是字符串、整数或 null")
    if "limit" in params:
        _validate_limit(params["limit"])


def _validate_subscribe_params(params: Mapping[str, object]) -> None:
    _reject_unknown(params, ("since",), "event.subscribe 参数")
    if "since" not in params:
        return
    since = params["since"]
    if not _is_integer(since) or cast("int | float", since) < 0:
        raise InvalidFrameError("since 必须是非负整数")


_PARAMS_VALIDATORS: dict[str, ParamsValidator] = {
    "state.snapshot": _validate_snapshot_params,
    "cmd.invoke": _validate_cmd_params,
    "query.invoke": _validate_query_params,
    "event.subscribe": _validate_subscribe_params,
    "ping": _validate_ping_params,
}
