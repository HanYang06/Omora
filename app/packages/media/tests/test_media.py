import base64
from pathlib import Path

import pytest

from omora.core.kernel import Kernel
from omora.media import Media, MediaPlugin


def test_saving_and_loading_a_media_file(tmp_path: Path) -> None:
    media = Media(tmp_path)

    media_id = media.save(b"hello", "audio/webm")

    loaded = media.load(media_id)
    assert loaded["mime"] == "audio/webm"
    assert base64.b64decode(loaded["data"]) == b"hello"


def test_media_survives_reopening_the_directory(tmp_path: Path) -> None:
    media_id = Media(tmp_path).save(b"hello", "audio/webm")

    loaded = Media(tmp_path).load(media_id)

    assert base64.b64decode(loaded["data"]) == b"hello"


def test_unknown_media_says_so(tmp_path: Path) -> None:
    with pytest.raises(LookupError, match="媒体不存在: nope"):
        Media(tmp_path).load("nope")


def test_a_traversal_id_is_not_a_file(tmp_path: Path) -> None:
    with pytest.raises(LookupError, match="媒体不存在"):
        Media(tmp_path).load("../secret")


def test_installing_the_plugin_makes_media_reachable_by_name(tmp_path: Path) -> None:
    kernel = Kernel()

    kernel.install(MediaPlugin(root=str(tmp_path / "media")))

    media = kernel.resolve("media")
    media_id = media.save(b"hello", "audio/webm")
    assert media.load(media_id)["mime"] == "audio/webm"


def test_uninstalling_the_plugin_takes_media_away(tmp_path: Path) -> None:
    kernel = Kernel()
    kernel.install(MediaPlugin(root=str(tmp_path / "media")))

    kernel.uninstall("media")

    with pytest.raises(LookupError, match="服务未提供: media"):
        kernel.resolve("media")
