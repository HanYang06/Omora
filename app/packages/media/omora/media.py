"""media：音频 / 视频文件的存取。

系统插件，不产出界面。文件落在本地目录，一条索引记 mime；读的时候给 base64。
"""

from __future__ import annotations

import base64
import json
import uuid
from pathlib import Path
from typing import Any

from omora.sdk import Context


class Media:
    def __init__(self, root: str | Path) -> None:
        self._root = Path(root)
        self._root.mkdir(parents=True, exist_ok=True)
        self._index_path = self._root / "index.json"
        self._index: dict[str, dict[str, Any]] = {}
        if self._index_path.is_file():
            try:
                raw: Any = json.loads(self._index_path.read_text(encoding="utf-8"))
            except ValueError:
                raw = None
            if isinstance(raw, dict):
                self._index = {
                    str(key): dict(value)
                    for key, value in raw.items()
                    if isinstance(value, dict)
                }

    def save(self, data: bytes, mime: str) -> str:
        """存一份媒体；返回它的 id。"""
        media_id = uuid.uuid4().hex
        (self._root / media_id).write_bytes(data)
        self._index[media_id] = {"mime": mime, "size": len(data)}
        self._write_index()
        return media_id

    def load(self, media_id: str) -> dict[str, str]:
        """取一份媒体：mime + base64 数据。"""
        if not media_id or "/" in media_id or "\\" in media_id:
            raise LookupError(f"媒体不存在: {media_id}")
        path = self._root / media_id
        if not path.is_file():
            raise LookupError(f"媒体不存在: {media_id}")
        entry = self._index.get(media_id, {})
        mime = str(entry.get("mime", "application/octet-stream"))
        return {"mime": mime, "data": base64.b64encode(path.read_bytes()).decode("ascii")}

    def _write_index(self) -> None:
        self._index_path.write_text(
            json.dumps(self._index, ensure_ascii=False), encoding="utf-8"
        )


class MediaPlugin:
    name = "media"

    def __init__(self, root: str = ".omora/media") -> None:
        self.root = root

    def apply(self, ctx: Context) -> None:
        ctx.provide("media", Media(self.root))


__all__ = ["Media", "MediaPlugin"]
