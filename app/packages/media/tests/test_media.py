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


def test_upload_refuses_an_empty_file(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="空媒体"):
        Media(tmp_path).upload(b"", "video/webm")


def test_upload_refuses_a_file_over_the_limit(tmp_path: Path) -> None:
    media = Media(tmp_path, max_mb=1)

    with pytest.raises(ValueError, match="媒体太大"):
        media.upload(b"x" * (1024 * 1024 + 1), "video/webm")


def test_upload_stores_what_read_gives_back(tmp_path: Path) -> None:
    media = Media(tmp_path)

    media_id = media.upload(b"video-bytes", "video/webm")

    assert media.read(media_id) == {"mime": "video/webm", "data": b"video-bytes"}


def test_info_reports_mime_and_size(tmp_path: Path) -> None:
    media = Media(tmp_path)
    media_id = media.save(b"hello", "audio/webm")

    assert Media(tmp_path).info(media_id) == {"mime": "audio/webm", "size": 5}


def test_info_of_unknown_media_says_so(tmp_path: Path) -> None:
    with pytest.raises(LookupError, match="媒体不存在: nope"):
        Media(tmp_path).info("nope")


def test_read_gives_raw_bytes_not_base64(tmp_path: Path) -> None:
    media_id = Media(tmp_path).save(b"\x00\x01", "video/webm")

    assert Media(tmp_path).read(media_id)["data"] == b"\x00\x01"


def test_deleting_a_media_removes_the_file_and_the_index_entry(tmp_path: Path) -> None:
    media = Media(tmp_path)
    media_id = media.save(b"hello", "audio/webm")

    media.delete(media_id)

    assert not (tmp_path / media_id).exists()
    with pytest.raises(LookupError, match="媒体不存在"):
        media.load(media_id)


def test_deleting_unknown_media_says_so(tmp_path: Path) -> None:
    with pytest.raises(LookupError, match="媒体不存在: nope"):
        Media(tmp_path).delete("nope")
