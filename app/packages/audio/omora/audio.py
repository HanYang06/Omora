"""audio：音频捕捉。

设备、权限、热插拔由客户端（TS 引擎）检测；这里管音质档、降噪开关、时限，
以及录完之后的后期处理钩子。字节存进 media 服务，audio 自己不碰文件。

它和 video 是两个插件，不是同一个插件的两半：没有麦克风时只该关掉音频，
不该连摄像头一起关掉。
"""

from __future__ import annotations

import base64
from collections.abc import Callable
from typing import Any

from omora.sdk import Context
from omora.sdk.ui import AudioCapture, Handler

QUALITIES = ("low", "high")
DEFAULT_SECONDS = 600

Processor = Callable[[bytes, str], bytes]
"""后期处理钩子：原始音频字节 + mime → 新字节。按登记顺序跑，抛错就算这条没收成。"""


class Audio:
    def __init__(
        self,
        media: Any,
        *,
        quality: str = "high",
        noise_reduction: bool | str = True,
        max_seconds: int | str = DEFAULT_SECONDS,
    ) -> None:
        if quality not in QUALITIES:
            raise ValueError(f"未知音质档: {quality}（可选 {', '.join(QUALITIES)}）")
        self._media = media
        self.quality = quality
        self.noise_reduction = _flag(noise_reduction)
        self.max_seconds = int(max_seconds)
        self._processors: list[Processor] = []

    def settings(self) -> dict[str, Any]:
        """页面与客户端要的一切：质量档、降噪、时限。"""
        return {
            "quality": self.quality,
            "noise_reduction": self.noise_reduction,
            "max_seconds": self.max_seconds,
        }

    def node(self, on_submit: Handler) -> AudioCapture:
        """给页面用的捕捉条；设备有没有、用户给不给权限，由客户端回答。"""
        return AudioCapture(
            on_submit=on_submit,
            quality=self.quality,
            noise_reduction=self.noise_reduction,
            max_seconds=self.max_seconds,
        )

    def add_processor(self, process: Processor) -> None:
        """登记一个后期处理钩子。"""
        self._processors.append(process)

    def capture(self, payload: dict[str, Any]) -> str | None:
        """收一条录音：坏数据、非音频、超时都返回 None（不收，也不把页面炸掉）。"""
        encoded = str(payload.get("audio", ""))
        if not encoded:
            return None
        try:
            data = base64.b64decode(encoded, validate=True)
        except ValueError:
            return None
        if not data:
            return None
        mime = str(payload.get("mime") or "audio/webm")
        if not mime.startswith("audio/"):
            return None
        if _seconds(payload) > self.max_seconds:
            return None
        for process in self._processors:
            data = process(data, mime)
        return str(self._media.save(data, mime))


class AudioPlugin:
    name = "audio"

    def __init__(
        self,
        quality: str = "high",
        noise_reduction: bool | str = True,
        max_seconds: int | str = DEFAULT_SECONDS,
    ) -> None:
        self.quality = str(quality)
        self.noise_reduction = noise_reduction
        self.max_seconds = max_seconds

    def apply(self, ctx: Context) -> None:
        media = ctx.resolve("media")
        ctx.provide(
            "audio",
            Audio(
                media,
                quality=self.quality,
                noise_reduction=self.noise_reduction,
                max_seconds=self.max_seconds,
            ),
        )


def _seconds(payload: dict[str, Any]) -> float:
    try:
        return float(payload.get("seconds", 0) or 0)
    except (TypeError, ValueError):
        return 0.0


def _flag(value: bool | str) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() not in {"false", "0", "no", "off", "none", ""}


__all__ = ["QUALITIES", "Audio", "AudioPlugin", "Processor"]
