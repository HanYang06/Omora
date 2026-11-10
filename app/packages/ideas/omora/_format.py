"""灵感页的文字：时间、片段、捕捉标题。纯函数，不知道 store 也不知道界面。"""

from __future__ import annotations

from datetime import datetime
from typing import Any

_WEEKDAYS = ("周一", "周二", "周三", "周四", "周五", "周六", "周日")
_SNIPPET = 40
_MAX_PEAKS = 300


def now() -> datetime:
    """页面的钟。测试换掉它，「现在」就定了。"""
    return datetime.now()


def when(created: datetime, current: datetime | None = None) -> str:
    """把时间写成索引栏左栏那一句话。"""
    moment = current or now()
    seconds = (moment - created).total_seconds()
    if seconds < 60:
        return "刚刚"
    if seconds < 3600:
        return f"{int(seconds // 60)} 分钟前"
    if created.date() == moment.date():
        return f"{int(seconds // 3600)} 小时前"
    days = (moment.date() - created.date()).days
    if days == 1:
        return "昨天"
    if days < 7:
        return _WEEKDAYS[created.weekday()]
    return f"{created.month} 月 {created.day} 日"


def snippet(text: str, query: str, width: int = _SNIPPET) -> str:
    """命中词附近的一段；标题本来就短就原样给。"""
    needle = query.strip()
    if not needle or len(text) <= width:
        return text
    at = text.lower().find(needle.lower())
    if at < 0:
        return text[:width] + "…"
    start = min(max(0, at - (width - len(needle)) // 2), len(text) - width)
    piece = text[start : start + width]
    if start > 0:
        piece = "…" + piece
    if start + width < len(text):
        piece += "…"
    return piece


def clock(value: float) -> str:
    total = max(0, int(value))
    return f"{total // 60}:{total % 60:02d}"


def seconds(payload: dict[str, Any]) -> float:
    try:
        return float(payload.get("seconds", 0) or 0)
    except (TypeError, ValueError):
        return 0.0


def peaks(payload: dict[str, Any]) -> tuple[int, ...]:
    """引擎顺手采的柱高：0–100、最多 300 个；坏值丢掉，别把页面炸掉。"""
    raw = payload.get("peaks")
    if not isinstance(raw, (list, tuple)):
        return ()
    kept: list[int] = []
    for value in raw[:_MAX_PEAKS]:
        try:
            kept.append(max(0, min(100, int(value))))
        except (TypeError, ValueError):
            continue
    return tuple(kept)


def caption(created: datetime, kind: str) -> str:
    """捕捉的默认名：保存时刻的时间轴（月-日 时:分），不是时长。"""
    return f"{kind} {created.month:02d}-{created.day:02d} {created.hour:02d}:{created.minute:02d}"
