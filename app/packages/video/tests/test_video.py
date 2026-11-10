from pathlib import Path
from typing import Any

import pytest

from omora.core.context import Context
from omora.core.kernel import Kernel
from omora.media import Media, MediaPlugin
from omora.sdk.ui import Handler, serialize
from omora.video import Video, VideoPlugin

CHANNEL = "http://127.0.0.1:8766/media"


class _Net:
    def __init__(self, media_url: str | None) -> None:
        self.media_url = media_url


def _ctx(tmp_path: Path, *, channel: str | None = CHANNEL) -> Context:
    ctx = Context()
    ctx.provide("media", Media(tmp_path / "media"))
    if channel is not None:
        ctx.provide("net", _Net(channel if channel != "" else None))
    return ctx


def _video(ctx: Context, **settings: Any) -> Video:
    return Video(ctx, ctx.resolve("media"), **settings)


def _stored(ctx: Context, data: bytes = b"video-bytes", mime: str = "video/webm") -> str:
    return str(ctx.resolve("media").save(data, mime))


def _noop(payload: dict[str, Any]) -> None:
    pass


def test_no_media_channel_means_no_capture_node(tmp_path: Path) -> None:
    ctx = _ctx(tmp_path, channel=None)

    assert _video(ctx).node(_noop) is None


def test_a_channel_that_has_not_started_means_no_capture_node(tmp_path: Path) -> None:
    ctx = Context()
    ctx.provide("media", Media(tmp_path / "media"))
    ctx.provide("net", _Net(None))

    assert _video(ctx).node(_noop) is None


def test_the_node_carries_the_upload_url_quality_and_the_time_limit(tmp_path: Path) -> None:
    handler: Handler = _noop

    node = _video(_ctx(tmp_path), quality="1080p", max_seconds=45).node(handler)

    assert node is not None
    assert serialize(node, lambda _: "h") == {
        "type": "video_capture",
        "props": {
            "on_submit": "h",
            "upload_url": CHANNEL,
            "quality": "1080p",
            "max_seconds": 45,
            "pausable": True,
        },
        "children": [],
    }


def test_a_captured_video_keeps_the_stored_media_and_returns_its_id(tmp_path: Path) -> None:
    ctx = _ctx(tmp_path)
    media_id = _stored(ctx)

    assert _video(ctx, post_process=False).capture({"media": media_id, "seconds": 3}) == media_id
    assert ctx.resolve("media").info(media_id)["mime"] == "video/webm"


def test_an_unknown_media_id_is_ignored(tmp_path: Path) -> None:
    assert _video(_ctx(tmp_path)).capture({"media": "nope", "seconds": 1}) is None


def test_a_non_video_upload_is_dropped(tmp_path: Path) -> None:
    ctx = _ctx(tmp_path)
    media_id = _stored(ctx, b"hello", "audio/webm")

    assert _video(ctx).capture({"media": media_id, "seconds": 1}) is None
    with pytest.raises(LookupError, match="媒体不存在"):
        ctx.resolve("media").load(media_id)


def test_a_video_over_the_time_limit_is_dropped(tmp_path: Path) -> None:
    ctx = _ctx(tmp_path)
    media_id = _stored(ctx)

    assert _video(ctx, max_seconds=2).capture({"media": media_id, "seconds": 2.5}) is None
    with pytest.raises(LookupError, match="媒体不存在"):
        ctx.resolve("media").load(media_id)


def test_a_video_over_the_size_limit_is_dropped(tmp_path: Path) -> None:
    ctx = _ctx(tmp_path)
    media_id = _stored(ctx, b"x" * (1024 * 1024 + 1))

    assert _video(ctx, max_mb=1).capture({"media": media_id, "seconds": 1}) is None
    with pytest.raises(LookupError, match="媒体不存在"):
        ctx.resolve("media").load(media_id)


def test_a_processor_sees_the_stored_media_and_its_info(tmp_path: Path) -> None:
    ctx = _ctx(tmp_path)
    media_id = _stored(ctx)
    seen: list[tuple[str, dict[str, Any]]] = []

    video = _video(ctx)
    video.add_processor(lambda stored_id, info: seen.append((stored_id, info)))

    assert video.capture({"media": media_id, "seconds": 3}) == media_id
    assert seen == [(media_id, {"mime": "video/webm", "size": 11})]


def test_an_unknown_quality_is_rejected_at_startup(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="未知清晰度: 4k"):
        _video(_ctx(tmp_path), quality="4k")


def test_the_playback_url_is_the_channel_plus_the_id(tmp_path: Path) -> None:
    assert _video(_ctx(tmp_path)).src("abc") == f"{CHANNEL}/abc"


def test_a_video_without_the_media_service_fails_to_load(tmp_path: Path) -> None:
    kernel = Kernel()

    with pytest.raises(LookupError, match="服务未提供: media"):
        kernel.install(VideoPlugin())


def test_uninstalling_video_takes_the_service_away(tmp_path: Path) -> None:
    kernel = Kernel()
    kernel.install(MediaPlugin(root=str(tmp_path / "media")))
    kernel.install(VideoPlugin())

    kernel.uninstall("video")

    with pytest.raises(LookupError, match="服务未提供: video"):
        kernel.resolve("video")
