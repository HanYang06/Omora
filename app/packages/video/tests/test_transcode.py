import subprocess
import tempfile
from pathlib import Path
from typing import Any

import pytest

from omora import _transcode
from omora.core.context import Context
from omora.media import Media
from omora.video import Video


def _clip() -> bytes:
    """现造一段 1 秒的测试片：后处理得有真文件才能验。"""
    with tempfile.TemporaryDirectory(prefix="omora-fixture-") as folder:
        target = Path(folder) / "in.mp4"
        subprocess.run(
            [
                _transcode.ffmpeg(),
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=160x120:rate=10",
                "-t",
                "1",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                str(target),
            ],
            check=True,
        )
        return target.read_bytes()


def _ctx(tmp_path: Path) -> Context:
    ctx = Context()
    ctx.provide("media", Media(tmp_path / "media"))
    return ctx


def test_the_command_carries_the_whole_chain() -> None:
    line = _transcode.command(Path("in.media"), Path("out.mp4"))

    assert "libx264" in line
    assert "-crf" in line
    for every in ("hqdn3d", "deflicker", "eq="):
        assert any(every in item for item in line), every
    # 锐化会把噪点一起放大，体积实测涨 37%：这条不该出现
    assert not any("unsharp" in item for item in line)


def test_a_real_clip_comes_back_as_an_mp4() -> None:
    data = _clip()

    processed, mime = _transcode.process(data)

    assert mime == "video/mp4"
    assert processed[4:8] == b"ftyp"
    assert len(processed) > 1000


def test_a_broken_file_raises_instead_of_returning_junk() -> None:
    with pytest.raises(RuntimeError):
        _transcode.process(b"not a video at all")


def test_a_failed_post_process_keeps_the_original(tmp_path: Path) -> None:
    ctx = _ctx(tmp_path)
    media = ctx.resolve("media")
    media_id = str(media.save(b"not a video at all", "video/webm"))
    video = Video(ctx, media)

    assert video.capture({"media": media_id, "seconds": 1}) == media_id
    assert media.info(media_id)["mime"] == "video/webm"


def test_post_process_switched_off_keeps_the_uploaded_bytes(tmp_path: Path) -> None:
    ctx = _ctx(tmp_path)
    media = ctx.resolve("media")
    media_id = str(media.save(b"whatever", "video/webm"))
    video = Video(ctx, media, post_process=False)

    assert video.capture({"media": media_id, "seconds": 1}) == media_id
    assert media.read(media_id)["data"] == b"whatever"


def test_a_transcoded_capture_is_stored_as_a_new_mp4(tmp_path: Path) -> None:
    ctx = _ctx(tmp_path)
    media = ctx.resolve("media")
    media_id = str(media.save(_clip(), "video/webm"))
    video = Video(ctx, media)

    fresh: Any = video.capture({"media": media_id, "seconds": 1})

    assert fresh != media_id
    assert media.info(fresh)["mime"] == "video/mp4"
    with pytest.raises(LookupError):
        media.info(media_id)
