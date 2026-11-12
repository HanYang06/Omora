"""video：视频捕捉。

视频字节不走 base64：客户端先 POST 到 net 的 HTTP 媒体通道拿 media_id，
这里只校验（mime / 时限 / 大小）、跑后期处理钩子，再把 id 交给调用方。
设备和预览在客户端；文件在 media 服务。

它和 audio 是两个插件：没有摄像头时只该关掉视频。
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from omora.sdk import Context
from omora.sdk.ui import Handler, VideoCapture

from . import _transcode

QUALITIES = ("480p", "720p", "1080p")
DEFAULT_SECONDS = 1800
DEFAULT_MB = 64

Processor = Callable[[str, dict[str, Any]], None]
"""后期处理钩子：media id + {mime, size}。v0 只看不改（没有转码）。"""


class Video:
    def __init__(  # noqa: PLR0913 —— 插件装配的声明式参数
        self,
        ctx: Context,
        media: Any,
        *,
        quality: str = "720p",
        max_seconds: int | str = DEFAULT_SECONDS,
        max_mb: int | str = DEFAULT_MB,
        post_process: bool | str = True,
    ) -> None:
        if quality not in QUALITIES:
            raise ValueError(f"未知清晰度: {quality}（可选 {', '.join(QUALITIES)}）")
        self._ctx = ctx
        self._media = media
        self.quality = quality
        self.max_seconds = int(max_seconds)
        self.max_bytes = int(max_mb) * 1024 * 1024
        self.post_process = _flag(post_process)
        self._processors: list[Processor] = []

    def settings(self) -> dict[str, Any]:
        return {
            "quality": self.quality,
            "max_seconds": self.max_seconds,
            "max_mb": self.max_bytes // (1024 * 1024),
            "upload_url": self.channel(),
        }

    def channel(self) -> str | None:
        """HTTP 媒体通道的地址；net 没装或还没起就是 None。"""
        if not self._ctx.has("net"):
            return None
        url = getattr(self._ctx.resolve("net"), "media_url", None)
        return url if isinstance(url, str) and url else None

    def node(self, on_submit: Handler) -> VideoCapture | None:
        """给页面用的捕捉条。

        没有媒体通道就不出（视频存不下，出了也没用）；这台机器上没有摄像头也不出。
        """
        url = self.channel()
        if url is None:
            return None
        if not self._has_device("videoinput"):
            return None
        return VideoCapture(
            on_submit=on_submit,
            upload_url=url,
            quality=self.quality,
            max_seconds=self.max_seconds,
            pausable=True,
        )

    def src(self, media_id: str) -> str | None:
        """一条视频的播放地址；没有媒体通道就是 None。"""
        url = self.channel()
        return None if url is None else f"{url}/{media_id}"

    def _has_device(self, kind: str) -> bool:
        if not self._ctx.has("manager"):
            return True
        manager: Any = self._ctx.resolve("manager")
        reported = getattr(manager, "reported", None)
        # 客户端还没报过之前不藏界面：组件自己会在没有设备时禁用并写原因。
        if not callable(reported) or not reported():
            return True
        return kind in tuple(manager.devices())

    def add_processor(self, process: Processor) -> None:
        self._processors.append(process)

    def capture(self, payload: dict[str, Any]) -> str | None:
        """收一条上传完的视频：不存在、非视频、超时、超大都返回 None。"""
        media_id = str(payload.get("media", ""))
        if not media_id:
            return None
        try:
            info: dict[str, Any] = self._media.info(media_id)
        except LookupError:
            return None
        if not str(info.get("mime", "")).startswith("video/"):
            self._drop(media_id)
            return None
        if _seconds(payload) > self.max_seconds:
            self._drop(media_id)
            return None
        if int(info.get("size", 0)) > self.max_bytes:
            self._drop(media_id)
            return None
        for process in self._processors:
            process(media_id, info)
        if self.post_process:
            media_id = self._repack(media_id)
        return media_id

    def _repack(self, media_id: str) -> str:
        """过一遍后处理：降噪、去闪烁、重编码。失败保留原件，不能吃掉用户的录像。"""
        log = self._ctx.log.child("video")
        try:
            before = self._media.info(media_id)
            processed, mime = _transcode.process(self._media.read(media_id)["data"])
            fresh = str(self._media.save(processed, mime))
            self._media.delete(media_id)
            log.info(
                "video.post_process",
                before=int(before["size"]),
                after=len(processed),
            )
            return fresh
        except Exception as exc:
            log.warning("video.post_process.failed", err=type(exc).__name__)
            return media_id

    def _drop(self, media_id: str) -> None:
        try:
            self._media.delete(media_id)
        except LookupError:
            return


class VideoPlugin:
    name = "video"

    def __init__(
        self,
        quality: str = "720p",
        max_seconds: int | str = DEFAULT_SECONDS,
        max_mb: int | str = DEFAULT_MB,
        post_process: bool | str = True,
    ) -> None:
        self.quality = str(quality)
        self.max_seconds = max_seconds
        self.max_mb = max_mb
        self.post_process = post_process

    def apply(self, ctx: Context) -> None:
        media = ctx.resolve("media")
        ctx.provide(
            "video",
            Video(
                ctx,
                media,
                quality=self.quality,
                max_seconds=self.max_seconds,
                max_mb=self.max_mb,
                post_process=self.post_process,
            ),
        )


def _flag(value: bool | str) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() not in {"false", "0", "no", "off", "none", ""}


def _seconds(payload: dict[str, Any]) -> float:
    try:
        return float(payload.get("seconds", 0) or 0)
    except TypeError, ValueError:
        return 0.0


__all__ = ["QUALITIES", "Processor", "Video", "VideoPlugin"]
