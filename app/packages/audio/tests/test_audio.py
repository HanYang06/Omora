from pathlib import Path
from typing import Any

import pytest

from omora.audio import Audio, AudioPlugin
from omora.core.context import Context
from omora.core.kernel import Kernel
from omora.media import Media, MediaPlugin
from omora.sdk.ui import Handler, serialize

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


def _audio(ctx: Context, **settings: Any) -> Audio:
    return Audio(ctx, ctx.resolve("media"), **settings)


def _stored(ctx: Context, data: bytes = b"hello", mime: str = "audio/webm") -> str:
    return str(ctx.resolve("media").save(data, mime))


def _take(media_id: str, seconds: float = 3.2) -> dict[str, Any]:
    return {"media": media_id, "mime": "audio/webm", "seconds": seconds}


def _kernel(tmp_path: Path) -> Kernel:
    kernel = Kernel()
    kernel.install(MediaPlugin(root=str(tmp_path / "media")))
    kernel.install(AudioPlugin())
    return kernel


def _noop(payload: dict[str, Any]) -> None:
    pass


def test_no_media_channel_means_no_capture_node(tmp_path: Path) -> None:
    ctx = _ctx(tmp_path, channel=None)

    assert _audio(ctx).node(_noop) is None


def test_a_channel_that_has_not_started_means_no_capture_node(tmp_path: Path) -> None:
    ctx = _ctx(tmp_path, channel="")

    assert _audio(ctx).node(_noop) is None


def test_the_node_carries_the_upload_url_quality_noise_reduction_and_the_limit(
    tmp_path: Path,
) -> None:
    handler: Handler = _noop

    node = _audio(_ctx(tmp_path), quality="low", noise_reduction=False, max_seconds=30).node(
        handler
    )

    assert node is not None
    assert serialize(node, lambda _: "h") == {
        "type": "audio_capture",
        "props": {
            "on_submit": "h",
            "upload_url": CHANNEL,
            "quality": "low",
            "noise_reduction": False,
            "max_seconds": 30,
            "pausable": True,
        },
        "children": [],
    }


def test_a_captured_recording_keeps_the_stored_media_and_returns_its_id(tmp_path: Path) -> None:
    ctx = _ctx(tmp_path)
    uploaded = _stored(ctx)

    assert _audio(ctx).capture(_take(uploaded)) == uploaded
    assert ctx.resolve("media").info(uploaded)["mime"] == "audio/webm"


def test_a_capture_without_a_media_id_is_ignored(tmp_path: Path) -> None:
    assert _audio(_ctx(tmp_path)).capture({"mime": "audio/webm", "seconds": 1}) is None


def test_an_unknown_media_id_is_ignored(tmp_path: Path) -> None:
    assert _audio(_ctx(tmp_path)).capture(_take("nope")) is None


def test_a_non_audio_upload_is_dropped(tmp_path: Path) -> None:
    ctx = _ctx(tmp_path)
    uploaded = _stored(ctx, b"video-bytes", "video/webm")

    assert _audio(ctx).capture(_take(uploaded)) is None
    with pytest.raises(LookupError, match="媒体不存在"):
        ctx.resolve("media").load(uploaded)


def test_a_recording_at_the_time_limit_is_kept(tmp_path: Path) -> None:
    ctx = _ctx(tmp_path)
    uploaded = _stored(ctx)

    assert _audio(ctx, max_seconds=2).capture(_take(uploaded, seconds=2)) == uploaded


def test_a_recording_over_the_time_limit_is_dropped(tmp_path: Path) -> None:
    ctx = _ctx(tmp_path)
    uploaded = _stored(ctx)

    assert _audio(ctx, max_seconds=2).capture(_take(uploaded, seconds=2.5)) is None
    with pytest.raises(LookupError, match="媒体不存在"):
        ctx.resolve("media").load(uploaded)


def test_an_unlimited_recording_accepts_a_three_hour_take(tmp_path: Path) -> None:
    """max_seconds=0 是不限，不是立刻超限。"""
    ctx = _ctx(tmp_path)
    uploaded = _stored(ctx)

    assert _audio(ctx).capture(_take(uploaded, seconds=3 * 60 * 60)) == uploaded


def test_a_processor_sees_the_stored_bytes_and_mime(tmp_path: Path) -> None:
    ctx = _ctx(tmp_path)
    uploaded = _stored(ctx)
    seen: list[tuple[bytes, str]] = []

    def record(data: bytes, mime: str) -> bytes:
        seen.append((data, mime))
        return data

    audio = _audio(ctx)
    audio.add_processor(record)

    audio.capture(_take(uploaded))

    assert seen == [(b"hello", "audio/webm")]


def test_a_processor_rewrites_the_bytes_into_a_new_media(tmp_path: Path) -> None:
    ctx = _ctx(tmp_path)
    uploaded = _stored(ctx)
    audio = _audio(ctx)
    audio.add_processor(lambda data, _mime: data.upper())
    audio.add_processor(lambda data, _mime: data + b"!")

    fresh = audio.capture(_take(uploaded))

    assert fresh is not None
    assert fresh != uploaded
    stored = ctx.resolve("media").read(fresh)
    assert (stored["mime"], stored["data"]) == ("audio/webm", b"HELLO!")
    with pytest.raises(LookupError, match="媒体不存在"):
        ctx.resolve("media").read(uploaded)


def test_a_failing_processor_keeps_the_original_recording(tmp_path: Path) -> None:
    ctx = _ctx(tmp_path)
    uploaded = _stored(ctx)

    def boom(_data: bytes, _mime: str) -> bytes:
        raise ValueError("降噪炸了")

    audio = _audio(ctx)
    audio.add_processor(boom)

    kept = audio.capture(_take(uploaded))

    assert kept == uploaded
    assert ctx.resolve("media").read(uploaded)["data"] == b"hello"


def test_an_unknown_quality_is_rejected_at_startup(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="未知音质档: ultra"):
        _audio(_ctx(tmp_path), quality="ultra")


def test_installing_audio_makes_the_service_reachable_by_name(tmp_path: Path) -> None:
    kernel = _kernel(tmp_path)
    uploaded = str(kernel.resolve("media").save(b"hello", "audio/webm"))

    audio = kernel.resolve("audio")
    media_id = audio.capture({"media": uploaded, "seconds": 2})

    assert media_id == uploaded
    assert kernel.resolve("media").load(uploaded)["mime"] == "audio/webm"


def test_audio_without_the_media_service_fails_to_load(tmp_path: Path) -> None:
    kernel = Kernel()

    with pytest.raises(LookupError, match="服务未提供: media"):
        kernel.install(AudioPlugin())


def test_uninstalling_audio_takes_the_service_away(tmp_path: Path) -> None:
    kernel = _kernel(tmp_path)

    kernel.uninstall("audio")

    with pytest.raises(LookupError, match="服务未提供: audio"):
        kernel.resolve("audio")
