"""dist/tree 产物门禁：hash、页面侧表、文件集合。"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import tree_artifacts

EXAMPLE = tree_artifacts.ROOT / "schema" / "tree" / "example" / "tree.root.json"
MANIFEST = ("tree", "manifest.json")


def _count(node: dict[str, Any]) -> int:
    return 1 + sum(_count(child) for child in node["layout"])


def _document() -> dict[str, Any]:
    return json.loads(EXAMPLE.read_text(encoding="utf-8"))  # type: ignore[no-any-return]


def _write_dist(root: Path, document: dict[str, Any], *, name: str = "ideas") -> Path:
    dist = root / "dist"
    pages = dist / "tree" / "pages"
    pages.mkdir(parents=True)
    raw = json.dumps(document, ensure_ascii=False).encode("utf-8")
    (pages / f"{name}.json").write_bytes(raw)
    page = document["pages"][0]
    manifest = {
        "format": "omora.tree.build/1",
        "default": name,
        "pages": [
            {
                "name": name,
                "title": page["title"],
                "route": page["route"],
                "file": f"tree/pages/{name}.json",
                "hash": hashlib.sha256(raw).hexdigest()[:16],
                "nodes": _count(document["root"]),
            }
        ],
    }
    (dist / "tree" / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return dist


def test_valid_artifacts_pass(tmp_path: Path) -> None:
    assert tree_artifacts.check(_write_dist(tmp_path, _document())) == []


def test_missing_manifest_is_reported(tmp_path: Path) -> None:
    problems = tree_artifacts.check(tmp_path / "dist")

    assert problems
    assert "manifest" in problems[0]


def test_hash_mismatch_is_reported(tmp_path: Path) -> None:
    dist = _write_dist(tmp_path, _document())
    manifest_path = dist.joinpath(*MANIFEST)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["pages"][0]["hash"] = "0" * 16
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    assert any("hash" in problem for problem in tree_artifacts.check(dist))


def test_broken_document_is_reported(tmp_path: Path) -> None:
    document = _document()
    document["root"]["chain"] = "deadbeefdeadbeef"
    dist = _write_dist(tmp_path, document)

    assert any("文档不合法" in problem for problem in tree_artifacts.check(dist))


def test_extra_page_file_is_reported(tmp_path: Path) -> None:
    dist = _write_dist(tmp_path, _document())
    (dist / "tree" / "pages" / "stray.json").write_text("{}", encoding="utf-8")

    assert any("不一致" in problem for problem in tree_artifacts.check(dist))


def test_page_table_must_match_manifest(tmp_path: Path) -> None:
    dist = _write_dist(tmp_path, _document())
    manifest_path = dist.joinpath(*MANIFEST)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["pages"][0]["title"] = "别的标题"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    assert any("页面侧表" in problem for problem in tree_artifacts.check(dist))
