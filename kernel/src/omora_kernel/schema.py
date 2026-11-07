"""协议文件定位:环境变量优先,否则从包位置向上查找 protocol/ 目录。

宿主与传输层都需要按名字读取 protocol/ 下的 schema,这里只负责定位与解析 JSON,
不做任何校验策略。
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import cast

PROTOCOL_DIR_ENV = "OMORA_PROTOCOL_DIR"


def protocol_dir() -> Path:
    """返回 protocol/ 目录:OMORA_PROTOCOL_DIR 优先,否则向上查找。"""
    override = os.environ.get(PROTOCOL_DIR_ENV)
    if override:
        return Path(override)
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "protocol"
        if candidate.is_dir():
            return candidate
    raise FileNotFoundError(f"找不到 protocol/ 目录;可用 {PROTOCOL_DIR_ENV} 指定")


def load_schema(name: str) -> dict[str, object]:
    """读取 protocol/ 下名为 name 的 JSON schema 文件。"""
    path = protocol_dir() / name
    payload: object = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"schema 必须是 JSON 对象: {path}")
    return cast("dict[str, object]", payload)
