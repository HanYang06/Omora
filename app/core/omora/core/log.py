"""log：一条时间线，两个进程共用一套形状。

内核是唯一的写者。UI 引擎把日志通过帧通道送进内核的 log 服务（target=log,
method=write），内核照样落盘、照样上屏——所以终端里看到的是一条时间线，
不是一个进程一个窗口。

落盘是 .jsonl（一行一条 JSON，方便 grep 和事后合并）；控制台上是同一条的
人话版本。轮转交给 logging.handlers.RotatingFileHandler，不自己写。
"""

from __future__ import annotations

import json
import logging
import logging.handlers
import os
import sys
import time
from collections.abc import Sequence
from pathlib import Path
from typing import Any, ClassVar, TextIO

LEVELS = {
    "trace": logging.DEBUG - 5,
    "debug": logging.DEBUG,
    "info": logging.INFO,
    "warning": logging.WARNING,
    "error": logging.ERROR,
}
for _name, _value in LEVELS.items():
    logging.addLevelName(_value, _name.upper())

DEFAULT_LEVEL = "info"
MAX_BYTES = 5 * 1024 * 1024
BACKUPS = 3
PROC_LABEL = {"kernel": "K", "engine": "E"}


class _Json(logging.Formatter):
    """一行一条 JSON：两个进程、两条日志流最后都长这样。"""

    def format(self, record: logging.LogRecord) -> str:
        return json.dumps(
            {
                "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(record.created))
                + f".{int(record.msecs):03d}",
                "proc": getattr(record, "proc", "kernel"),
                "ch": getattr(record, "ch", "-"),
                "lvl": record.levelname.lower(),
                "msg": record.getMessage(),
                "data": getattr(record, "data", None) or None,
            },
            ensure_ascii=False,
        )


class _Human(logging.Formatter):
    """控制台上的一行：时间 进程 通道 · 消息 key=value。"""

    COLORS: ClassVar[dict[str, str]] = {
        "trace": "",
        "debug": "",
        "info": "",
        "warning": "\x1b[33m",
        "error": "\x1b[31m",
    }

    def format(self, record: logging.LogRecord) -> str:
        stamp = time.strftime("%H:%M:%S", time.localtime(record.created))
        stamp += f".{int(record.msecs):03d}"
        proc = getattr(record, "proc", "kernel")
        label = PROC_LABEL.get(proc, proc[:1].upper())
        channel = getattr(record, "ch", "-")
        data = getattr(record, "data", None) or {}
        tail = " ".join(f"{key}={_show(value)}" for key, value in data.items())
        line = f"{stamp} {label} {channel:<6} {record.getMessage()}"
        if tail:
            line += f"  {tail}"
        color = self.COLORS.get(record.levelname.lower(), "")
        return f"{color}{line}\x1b[0m" if color else line


_MAX_TEXT = 60


def _show(value: Any) -> str:
    if isinstance(value, float):
        return f"{value:.1f}"
    text = str(value)
    return text if len(text) <= _MAX_TEXT else text[: _MAX_TEXT - 3] + "…"


class Log:
    """一个通道上的出口。child() 换通道，别的都不变。"""

    def __init__(self, logger: logging.Logger, channel: str, proc: str, level: int) -> None:
        self._logger = logger
        self.channel = channel
        self.proc = proc
        self._level = level

    def child(self, channel: str) -> Log:
        return Log(self._logger, channel, self.proc, self._level)

    def trace(self, msg: str, **data: Any) -> None:
        self._write("trace", msg, data)

    def debug(self, msg: str, **data: Any) -> None:
        self._write("debug", msg, data)

    def info(self, msg: str, **data: Any) -> None:
        self._write("info", msg, data)

    def warning(self, msg: str, **data: Any) -> None:
        self._write("warning", msg, data)

    def error(self, msg: str, **data: Any) -> None:
        self._write("error", msg, data)

    def write_many(self, entries: Sequence[Any]) -> int:
        """一批别的进程送来的日志：一次帧、多条行，形状和 write 一样。"""
        count = 0
        for entry in entries:
            if isinstance(entry, dict):
                self.write(entry)
                count += 1
        return count

    def write(self, payload: dict[str, Any]) -> None:
        """别的进程送进来的那一条：形状一样，走同一条路。"""
        level = str(payload.get("lvl", "info")).lower()
        if level not in LEVELS:
            level = "info"
        data = payload.get("data")
        self._log(
            level,
            str(payload.get("msg", "")),
            {"proc": str(payload.get("proc", "engine")), "ch": str(payload.get("ch", "-"))},
            data if isinstance(data, dict) else {},
        )

    def _write(self, level: str, msg: str, data: dict[str, Any]) -> None:
        # 过滤交给 handler：文件全收，终端按级别。这里不拦，否则事后翻档会缺。
        self._log(level, msg, {"proc": self.proc, "ch": self.channel}, data)

    def _log(self, level: str, msg: str, extra: dict[str, Any], data: dict[str, Any]) -> None:
        self._logger.log(LEVELS[level], msg, extra={**extra, "data": data})


class NullLog(Log):
    """没配日志时的出口：什么都不写。测试和别的进程都拿它兜底。"""

    def __init__(self) -> None:
        self.channel = "-"
        self.proc = "-"
        self._level = logging.CRITICAL + 1

    def child(self, _channel: str) -> Log:
        return self

    def _log(self, _level: str, _msg: str, _extra: dict[str, Any], _data: dict[str, Any]) -> None:
        return


def level_of(text: str | None, default: str = DEFAULT_LEVEL) -> str:
    """OMORA_LOG 的值：info / debug / net:trace,ui:debug。"""
    if not text:
        return default
    head = text.split(",")[0].split(":")[0].strip().lower()
    return head if head in LEVELS else default


def build_log(
    path: Path | None = None,
    *,
    level: str = DEFAULT_LEVEL,
    stream: TextIO | None = None,
    human: bool = True,
) -> Log:
    """装好日志出口：文件（轮转）+ 控制台。"""
    logger = logging.getLogger("omora")
    for old in logger.handlers:
        old.close()
    logger.handlers.clear()
    # 文件全收（DEBUG 起），终端按配置过滤：事后翻档永远比当时少开一格强。
    logger.setLevel(logging.DEBUG)
    logger.propagate = False

    if path is not None:
        path.parent.mkdir(parents=True, exist_ok=True)
        handler = logging.handlers.RotatingFileHandler(
            path, maxBytes=MAX_BYTES, backupCount=BACKUPS, encoding="utf-8"
        )
        handler.setFormatter(_Json())
        handler.setLevel(logging.DEBUG)
        logger.addHandler(handler)

    if human:
        console = logging.StreamHandler(stream or sys.stdout)
        console.setFormatter(_Human())
        console.setLevel(LEVELS.get(level, logging.INFO))
        logger.addHandler(console)

    return Log(logger, "kernel", "kernel", LEVELS.get(level, logging.INFO))


def log_path(root: Path) -> Path:
    """默认落盘位置：<仓库>/.omora/logs/dev.jsonl；可用 OMORA_LOG_FILE 覆盖。"""
    override = os.environ.get("OMORA_LOG_FILE")
    if override:
        return Path(override)
    return root / ".omora" / "logs" / "dev.jsonl"


__all__ = [
    "DEFAULT_LEVEL",
    "LEVELS",
    "Log",
    "NullLog",
    "build_log",
    "level_of",
    "log_path",
]
