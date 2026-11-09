import base64
from pathlib import Path
from typing import Any

import pytest

from omora.audio import Audio, AudioPlugin
from omora.core.kernel import Kernel
from omora.media import Media, MediaPlugin
from omora.sdk.ui import Handler, serialize


def _media(tmp_path: Path) -> Media:
    return Media(tmp_path / "media")


def _audio(tmp_path: Path, **settings: Any) -> Audio:
    return Audio(_media(tmp_path), **settings)


def _kernel(tmp_path: Path) -> Kernel:
    kernel = Kernel()
    kernel.install(MediaPlugin(root=str(tmp_path / "media")))
    kernel.install(AudioPlugin())
    return kernel


def _capture(**payload: Any) -> dict[str, Any]:
    return {"audio": base64.b64encode(b"hello").decode("ascii"), "mime": "audio/webm", **payload}


def _noop(payload: dict[str, Any]) -> None:
    pass


def test_installing_audio_makes_the_service_reachable_by_name(tmp_path: Path) -> None:
    kernel = _kernel(tmp_path)

    audio = kernel.resolve("audio")
    media_id = audio.capture(_capture(seconds=2))

    assert isinstance(media_id, str)
    assert kernel.resolve("media").load(media_id)["mime"] == "audio/webm"


def test_the_node_carries_quality_noise_reduction_and_the_time_limit(tmp_path: Path) -> None:
    handler: Handler = _noop

    node = _audio(tmp_path, quality="low", noise_reduction=False, max_seconds=30).node(handler)

    assert serialize(node, lambda _: "h") == {
        "type": "audio_capture",
        "props": {
            "on_submit": "h",
            "quality": "low",
            "noise_reduction": False,
            "max_seconds": 30,
        },
        "children": [],
    }


def test_capturing_audio_stores_the_bytes_and_returns_the_media_id(tmp_path: Path) -> None:
    audio = _audio(tmp_path)

    media_id = audio.capture(_capture(seconds=3.2))

    assert media_id is not None
    stored = _media(tmp_path).load(media_id)
    assert base64.b64decode(stored["data"]) == b"hello"
    assert stored["mime"] == "audio/webm"


def test_an_empty_capture_is_ignored(tmp_path: Path) -> None:
    assert _audio(tmp_path).capture({"audio": "", "mime": "audio/webm", "seconds": 1}) is None


def test_broken_base64_is_ignored(tmp_path: Path) -> None:
    assert _audio(tmp_path).capture({"audio": "不是 base64", "mime": "audio/webm"}) is None


def test_a_non_audio_mime_is_ignored(tmp_path: Path) -> None:
    assert _audio(tmp_path).capture(_capture(mime="video/webm")) is None


def test_a_recording_at_the_time_limit_is_kept(tmp_path: Path) -> None:
    assert _audio(tmp_path, max_seconds=2).capture(_capture(seconds=2)) is not None


def test_a_recording_over_the_time_limit_is_ignored(tmp_path: Path) -> None:
    assert _audio(tmp_path, max_seconds=2).capture(_capture(seconds=2.5)) is None


def test_a_processor_rewrites_the_bytes_before_storage(tmp_path: Path) -> None:
    audio = _audio(tmp_path)
    audio.add_processor(lambda data, _mime: data.upper())
    audio.add_processor(lambda data, _mime: data + b"!")

    media_id = audio.capture(_capture())

    assert media_id is not None
    stored = _media(tmp_path).load(media_id)
    assert base64.b64decode(stored["data"]) == b"HELLO!"


def test_an_unknown_quality_is_rejected_at_startup(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="未知音质档: ultra"):
        _audio(tmp_path, quality="ultra")


def test_audio_without_the_media_service_fails_to_load(tmp_path: Path) -> None:
    kernel = Kernel()

    with pytest.raises(LookupError, match="服务未提供: media"):
        kernel.install(AudioPlugin())


def test_uninstalling_audio_takes_the_service_away(tmp_path: Path) -> None:
    kernel = _kernel(tmp_path)

    kernel.uninstall("audio")

    with pytest.raises(LookupError, match="服务未提供: audio"):
        kernel.resolve("audio")