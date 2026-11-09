"""帧的编解码。

只认信封：id、type、target、method、args。不认识任何服务和领域。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

BAD_FRAME = "bad_frame"
UNKNOWN_TARGET = "unknown_target"
UNKNOWN_METHOD = "unknown_method"
CALL_FAILED = "call_failed"


class FrameError(Exception):
    """帧不合法。code 与 frame_id 会原样带给对端。"""

    def __init__(self, code: str, message: str, frame_id: str | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.frame_id = frame_id


@dataclass(frozen=True)
class Call:
    id: str
    target: str
    method: str
    args: dict[str, Any]


def parse_call(raw: object) -> Call:
    """把一帧解析成调用。不合法就抛 FrameError（code = bad_frame）。"""
    if not isinstance(raw, dict):
        raise FrameError(BAD_FRAME, "帧必须是对象")

    frame_id = raw.get("id")
    if not isinstance(frame_id, str) or not frame_id:
        raise FrameError(BAD_FRAME, "id 必须是非空字符串")

    def bad(message: str) -> FrameError:
        return FrameError(BAD_FRAME, message, frame_id)

    if raw.get("type") != "call":
        raise bad("type 必须是 call")
    target = raw.get("target")
    if not isinstance(target, str) or not target:
        raise bad("target 必须是非空字符串")
    method = raw.get("method")
    if not isinstance(method, str) or not method:
        raise bad("method 必须是非空字符串")
    args: object = raw.get("args", {})
    if not isinstance(args, dict):
        raise bad("args 必须是对象")
    return Call(frame_id, target, method, args)


def result_frame(frame_id: str, value: Any) -> dict[str, Any]:
    return {"id": frame_id, "type": "result", "value": value}


def error_frame(frame_id: str | None, code: str, message: str) -> dict[str, Any]:
    return {"id": frame_id, "type": "error", "code": code, "message": message}
