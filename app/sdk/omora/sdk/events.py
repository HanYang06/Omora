"""事件载荷：插件回调收到的形状。

以前回调收的是裸 `dict[str, Any]`，字段全靠记。这里把形状写成类型：
回调参数标上它，编辑器就知道有哪些字段；不标也照样能跑（只是没提示）。
"""

from __future__ import annotations

from typing import TypedDict


class Submit(TypedDict):
    """输入框 / 搜索框回车：用户交上来的那串字。"""

    value: str


class Recorded(TypedDict):
    """录完一条媒体：media id 与元数据（字节不在事件里）。"""

    media: str
    mime: str
    seconds: float


class RecordedWithPeaks(Recorded, total=False):
    """录音额外带录制中采的波形峰值（0–100，最多 300 个）。"""

    peaks: list[int]


class Change(TypedDict):
    """控件变化：开关、勾选、下拉、数字、拖动，值都在 value 里。"""

    value: object


__all__ = ["Change", "Recorded", "RecordedWithPeaks", "Submit"]
