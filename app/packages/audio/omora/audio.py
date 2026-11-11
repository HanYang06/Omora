"""audio：音频捕捉。

设备、权限、热插拔由客户端（TS 引擎）检测；这里管音质档、降噪开关、时限，
以及录完之后的后期处理钩子。录音字节不走 base64：客户端先 POST 到 net 的
HTTP 媒体通道拿 media_id，这里只校验（存在 / mime / 时限）、跑后期钩子，再把
id 交给调用方。文件在 media 服务，audio 自己不碰文件。

它和 video 是两个插件，不是同一个插件的两半：没有麦克风时只该关掉音频，
不该连摄像头一起关掉。
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from omora.sdk import Context
from omora.sdk.ui import AudioCapture, Handler

QUALITIES = ("low", "high")
DEFAULT_SECONDS = 0
"""默认不限时长：0 表示不设上限。"""

Processor = Callable[[bytes, str], bytes]
"""后期处理钩子：原始音频字节 + mime → 新字节。按登记顺序跑。"""


class Audio:
    def __init__(
        self,
        ctx: Context,
        media: Any,
        *,
        quality: str = "high",
        noise_reduction: bool | str = True,
        max_seconds: int | str = DEFAULT_SECONDS,
    ) -> None:
        if quality not in QUALITIES:
            raise ValueError(f"未知音质档: {quality}（可选 {', '.join(QUALITIES)}）")
        self._ctx = ctx
        self._media = media
        self.quality = quality
        self.noise_reduction = _flag(noise_reduction)
        self.max_seconds = int(max_seconds)
        self._processors: list[Processor] = []

    def settings(self) -> dict[str, Any]:
        """页面与客户端要的一切：质量档、降噪、时限、往哪儿传。"""
        return {
            "quality": self.quality,
            "noise_reduction": self.noise_reduction,
            "max_seconds": self.max_seconds,
            "upload_url": self.channel(),
        }

    def channel(self) -> str | None:
        """HTTP 媒体通道的地址；net 没装或还没起就是 None。"""
        if not self._ctx.has("net"):
            return None
        url = getattr(self._ctx.resolve("net"), "media_url", None)
        return url if isinstance(url, str) and url else None

    def node(self, on_submit: Handler) -> AudioCapture | None:
        """给页面用的捕捉条。

        没有媒体通道就不出（音频存不下，出了也没用）；这台机器上没有麦克风也不出。
        "有没有麦克风"由插件自己判断：客户端只把设备种类报给 manager。
        """
        url = self.channel()
        if url is None:
            return None
        if not self._has_device("audioinput"):
            return None
        return AudioCapture(
            on_submit=on_submit,
            upload_url=url,
            quality=self.quality,
            noise_reduction=self.noise_reduction,
            max_seconds=self.max_seconds,
            pausable=True,
        )

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
        """登记一个后期处理钩子。"""
        self._processors.append(process)

    def src(self, media_id: str) -> str | None:
        """一条录音的播放 / 画波形地址；没有媒体通道就是 None。"""
        url = self.channel()
        return None if url is None else f"{url}/{media_id}"

    def capture(self, payload: dict[str, Any]) -> str | None:
        """收一条上传完的录音：不存在、非音频、超时都返回 None（不收，也不把页面炸掉）。"""
        media_id = str(payload.get("media", ""))
        if not media_id:
            return None
        try:
            info: dict[str, Any] = self._media.info(media_id)
        except LookupError:
            return None
        if not str(info.get("mime", "")).startswith("audio/"):
            self._drop(media_id)
            return None
        if self.max_seconds > 0 and _seconds(payload) > self.max_seconds:
            self._drop(media_id)
            return None
        if not self._processors:
            return media_id
        return self._post_process(media_id)

    def _post_process(self, media_id: str) -> str:
        """读字节 → 跑钩子 → 存新的 → 删旧的。失败保留原件，不能吃掉用户的录音。"""
        log = self._ctx.log.child("audio")
        try:
            before = self._media.info(media_id)
            piece = self._media.read(media_id)
            data: bytes = piece["data"]
            mime = str(piece["mime"])
            for process in self._processors:
                data = process(data, mime)
            fresh = str(self._media.save(data, mime))
            self._media.delete(media_id)
            log.info(
                "audio.post_process",
                before=int(before["size"]),
                after=len(data),
            )
            return fresh
        except Exception as exc:
            log.warning("audio.post_process.failed", err=type(exc).__name__)
            return media_id

    def _drop(self, media_id: str) -> None:
        try:
            self._media.delete(media_id)
        except LookupError:
            return


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
                ctx,
                media,
                quality=self.quality,
                noise_reduction=self.noise_reduction,
                max_seconds=self.max_seconds,
            ),
        )


def _seconds(payload: dict[str, Any]) -> float:
    try:
        return float(payload.get("seconds", 0) or 0)
    except TypeError, ValueError:
        return 0.0


def _flag(value: bool | str) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() not in {"false", "0", "no", "off", "none", ""}


__all__ = ["QUALITIES", "Audio", "AudioPlugin", "Processor"]
