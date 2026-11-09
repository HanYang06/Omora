"""media：音频 / 视频文件的存取。

系统插件，不产出界面。文件落在本地目录，一条索引记 mime / size。
读取有两条路：load 给 base64（音频 v0 仍走协议）；read 给原始字节（HTTP 媒体通道）。
"""

from __future__ import annotations

import base64
import json
import uuid
from pathlib import Path
from typing import Any

from omora.sdk import Context

_OCTET = "application/octet-stream"
DEFAULT_MB = 64


class Media:
    def __init__(self, root: str | Path, *, max_mb: int | str = DEFAULT_MB) -> None:
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
        self.max_bytes = int(max_mb) * 1024 * 1024

    def save(self, data: bytes, mime: str) -> str:
        """存一份媒体；返回它的 id。"""
        media_id = uuid.uuid4().hex
        (self._root / media_id).write_bytes(data)
        self._index[media_id] = {"mime": mime, "size": len(data)}
        self._write_index()
        return media_id

    def upload(self, data: bytes, mime: str) -> str:
        """HTTP 媒体通道的入库口：空媒体和超限都拒绝。"""
        if not data:
            raise ValueError("空媒体")
        if len(data) > self.max_bytes:
            raise ValueError(f"媒体太大: {len(data)} 字节，上限 {self.max_bytes}")
        return self.save(data, mime)

    def info(self, media_id: str) -> dict[str, Any]:
        """一条媒体的 mime / size；不存在就抛 LookupError。"""
        entry = self._index.get(media_id)
        path = self._path(media_id)
        if entry is None or not path.is_file():
            raise LookupError(f"媒体不存在: {media_id}")
        return {"mime": str(entry.get("mime", _OCTET)), "size": int(entry.get("size", 0))}

    def load(self, media_id: str) -> dict[str, str]:
        """取一份媒体：mime + base64（协议里的 v0 形式）。"""
        piece = self.read(media_id)
        return {
            "mime": str(piece["mime"]),
            "data": base64.b64encode(piece["data"]).decode("ascii"),
        }

    def read(self, media_id: str) -> dict[str, Any]:
        """取原始字节：HTTP 媒体通道用，不 base64。"""
        path = self._path(media_id)
        if not path.is_file():
            raise LookupError(f"媒体不存在: {media_id}")
        entry = self._index.get(media_id, {})
        return {"mime": str(entry.get("mime", _OCTET)), "data": path.read_bytes()}

    def delete(self, media_id: str) -> None:
        """删掉一份媒体；不存在就抛 LookupError。"""
        path = self._path(media_id)
        if media_id not in self._index and not path.is_file():
            raise LookupError(f"媒体不存在: {media_id}")
        path.unlink(missing_ok=True)
        self._index.pop(media_id, None)
        self._write_index()

    def _path(self, media_id: str) -> Path:
        if not media_id or "/" in media_id or "\\" in media_id or media_id in {".", ".."}:
            raise LookupError(f"媒体不存在: {media_id}")
        return self._root / media_id

    def _write_index(self) -> None:
        self._index_path.write_text(
            json.dumps(self._index, ensure_ascii=False), encoding="utf-8"
        )


class MediaPlugin:
    name = "media"

    def __init__(self, root: str = ".omora/media", max_mb: int | str = DEFAULT_MB) -> None:
        self.root = root
        self.max_mb = int(max_mb)

    def apply(self, ctx: Context) -> None:
        ctx.provide("media", Media(self.root, max_mb=self.max_mb))


__all__ = ["DEFAULT_MB", "Media", "MediaPlugin"]
