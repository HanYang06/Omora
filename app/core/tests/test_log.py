import io
import json
from pathlib import Path
from typing import Any

from omora.core.kernel import Kernel
from omora.core.log import NullLog, build_log


class _Plugin:
    name = "demo"

    def apply(self, ctx: Any) -> None:
        ctx.log.info("test.event", n=1)


def _lines(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def test_a_line_lands_in_the_file_and_on_the_console(tmp_path: Path) -> None:
    stream = io.StringIO()
    log = build_log(tmp_path / "dev.jsonl", stream=stream)
    log.child("ideas").info("event", h="ideas:1:2", ms=1.4)

    record = _lines(tmp_path / "dev.jsonl")[0]
    assert record["proc"] == "kernel"
    assert record["ch"] == "ideas"
    assert record["lvl"] == "info"
    assert record["msg"] == "event"
    assert record["data"] == {"h": "ideas:1:2", "ms": 1.4}

    shown = stream.getvalue()
    assert "ideas" in shown and "event" in shown and "ms=1.4" in shown


def test_the_level_filters_the_console_but_not_the_file(tmp_path: Path) -> None:
    stream = io.StringIO()
    log = build_log(tmp_path / "dev.jsonl", level="info", stream=stream)
    log.debug("看起来没人听")
    log.warning("这条要看见")

    shown = stream.getvalue()
    assert "看起来没人听" not in shown
    assert "这条要看见" in shown
    # 终端按级别过滤，文件全收：事后翻档不该缺东西
    assert [item["msg"] for item in _lines(tmp_path / "dev.jsonl")] == [
        "看起来没人听",
        "这条要看见",
    ]


def test_nothing_is_configured_so_nothing_blows_up() -> None:
    log = NullLog()
    log.info("丢进黑洞")
    assert log.child("any").channel == "-"


def test_the_kernel_records_what_it_installs_and_removes(tmp_path: Path) -> None:
    log = build_log(tmp_path / "dev.jsonl")
    kernel = Kernel(log, {"log": log})
    handle = kernel.install(_Plugin())

    messages = [(item["ch"], item["msg"]) for item in _lines(tmp_path / "dev.jsonl")]
    assert ("demo", "plugin.installed") in messages
    assert ("demo", "test.event") in messages

    handle.dispose()
    messages = [(item["ch"], item["msg"]) for item in _lines(tmp_path / "dev.jsonl")]
    assert ("demo", "plugin.removed") in messages


def test_a_whole_batch_of_engine_lines_comes_through_one_frame(tmp_path: Path) -> None:
    log = build_log(tmp_path / "dev.jsonl")
    count = log.write_many(
        [
            {"proc": "engine", "ch": "conn", "lvl": "info", "msg": "ws 连上"},
            {
                "proc": "engine",
                "ch": "render",
                "lvl": "debug",
                "msg": "收到快照",
                "data": {"page": "ideas"},
            },
            "不是一条日志",  # 送坏的东西进来也不能崩
        ]
    )

    assert count == 2
    assert [(item["proc"], item["ch"]) for item in _lines(tmp_path / "dev.jsonl")] == [
        ("engine", "conn"),
        ("engine", "render"),
    ]


def test_an_engine_line_is_written_through_the_same_exit(tmp_path: Path) -> None:
    log = build_log(tmp_path / "dev.jsonl")
    service = {"write": log.write}

    service["write"](
        {
            "proc": "engine",
            "ch": "render",
            "lvl": "debug",
            "msg": "收到快照",
            "data": {"page": "ideas"},
        }
    )

    record = _lines(tmp_path / "dev.jsonl")[0]
    assert record["proc"] == "engine"
    assert record["ch"] == "render"
    assert record["msg"] == "收到快照"
    assert record["data"] == {"page": "ideas"}
