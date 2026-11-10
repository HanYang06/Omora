"""灵感页的节点：索引栏一行、推荐卡片、搜索结果、媒体播放器、捕捉区。

只拼节点，不碰状态；handler 由页面传进来。
"""

from __future__ import annotations

from typing import Any

from omora.sdk.ui import (
    Audio,
    Button,
    Card,
    Handler,
    Input,
    Item,
    Node,
    Panel,
    Result,
    Row,
    Text,
    Video,
    Waveform,
)

from ._format import snippet, when


def rail_item(record: Any, on_click: Handler) -> Item:
    """索引栏的一行：时间 + 标题，整行可点；置顶 / 归档只在详情里做。"""
    return Item(when(record.created_at), record.title, on_click=on_click)


def back_bar(handler: Handler) -> Node:
    return Row(Button("← 返回", variant="ghost", on_click=handler))


def workspace(title: str, body: Node, on_collapse: Handler) -> Panel:
    """工作区：一行头部（媒体名 + 收起）+ 主体。"""
    return Panel(
        Row(Text(title), Button("收起", variant="ghost", on_click=on_collapse), spread=True),
        body,
    )


def saved(
    *,
    stamp: str,
    title: str,
    audio: str | None,
    peaks: tuple[int, ...],
    seconds: float,
    on_rename: Handler,
    on_again: Handler,
    on_collapse: Handler,
) -> Panel:
    """已保存条：第一行给一次命名与动作，音频再加一行静态波形。

    audio 是刚存那条的 media id；视频没有内联播放，也就没有波形。
    """
    top: list[Node] = [
        Text(f"已保存 · {stamp}"),
        Input(value=title, on_submit=on_rename),
    ]
    if audio is not None:
        top.append(Audio(media=audio))
    top.append(Button("再录一条", on_click=on_again))
    top.append(Button("收起", variant="ghost", on_click=on_collapse))
    rows: list[Node] = [Row(*top)]
    if audio is not None:
        rows.append(Waveform(peaks=peaks, seconds=seconds))
    return Panel(*rows)


def card(record: Any, media: Any, on_click: Handler) -> Card:
    """feed 里的一张卡：标题 + 时间（含语音 / 视频标记），点整张进详情。"""
    return Card(record.title, meta=meta(record, media), on_click=on_click)


def result(record: Any, query: str, media: Any, on_click: Handler) -> Result:
    return Result(
        title=record.title,
        snippet=snippet(record.title, query),
        meta=meta(record, media),
        highlight=query,
        on_click=on_click,
    )


def player(record: Any, media: Any, video: Any) -> Node | None:
    """一条记录怎么放：视频走 HTTP 媒体通道，音频仍走 media.load。"""
    if not record.media:
        return None
    info = media_info(media, record.media)
    if info is None:
        return None
    if str(info.get("mime", "")).startswith("video/"):
        if video is None:
            return None
        src = video.src(str(record.media))
        return Video(media=str(record.media), src=src) if src else None
    return Audio(media=str(record.media))


def kind(record: Any, media: Any) -> str | None:
    if not record.media:
        return None
    info = media_info(media, record.media)
    if info is None:
        return None
    return "视频" if str(info.get("mime", "")).startswith("video/") else "语音"


def meta(record: Any, media: Any) -> str:
    parts = [when(record.created_at)]
    if record.pinned:
        parts.insert(0, "置顶")
    label = kind(record, media)
    if label is not None:
        parts.append(label)
    return " · ".join(parts)


def media_info(media: Any, record_id: Any) -> dict[str, Any] | None:
    try:
        info: dict[str, Any] = media.info(str(record_id))
    except LookupError:
        return None
    return info
