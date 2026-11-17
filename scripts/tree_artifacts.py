"""构建产物门禁：`dist/tree/` 的每页文档必须是合法的 `dendro.tree/1` 文档。

和 Vite 插件分工：插件在构建期 compose + 形状校验；这里在产物落盘后按 Python 语义权威
再验一遍（id / chain / 同级 order / pages / active），并核对 manifest、文件与 hash。

    uv run python scripts/tree_artifacts.py
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "app"))

from omora.sdk.tree import TreeError, parse_document  # noqa: E402

DIST = ROOT / "app" / "ui-engine" / "dist"
FORMAT = "omora.tree.build/1"
HASH_LENGTH = 16


def _problems_of_entry(entry: dict[str, Any], where: str, dist: Path) -> list[str]:
    """核对一页：文件存在、hash 对得上、文档通过 Python 语义校验、页面侧表一致。"""
    problems: list[str] = []
    name = entry.get("name")
    file = entry.get("file")
    if not isinstance(name, str) or not isinstance(file, str):
        return [f"{where} 缺少 name / file"]
    path = dist / file
    if not path.is_file():
        return [f"{name}: 找不到产物 {file}"]
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()[:HASH_LENGTH]
    if entry.get("hash") != digest:
        problems.append(f"{name}: hash 与 manifest 不一致（{entry.get('hash')} != {digest}）")
    try:
        document = parse_document(json.loads(raw))
    except (json.JSONDecodeError, TreeError) as error:
        return [*problems, f"{name}: 文档不合法（{error}）"]
    if len(document.pages) != 1:
        problems.append(f"{name}: 每页文档必须只有一条页面侧表，实际 {len(document.pages)}")
        return problems
    page = document.pages[0]
    if document.active != page.id:
        problems.append(f"{name}: active 必须指向页面 id（{document.active} != {page.id}）")
    if page.title != entry.get("title") or page.route != entry.get("route"):
        problems.append(f"{name}: 页面侧表与 manifest 不一致")
    if entry.get("nodes") != _count_nodes(document):
        problems.append(f"{name}: 节点数与 manifest 不一致")
    return problems


def _count_nodes(document: Any) -> int:
    def walk(node: Any) -> int:
        templates = () if node.collection is None else node.collection.templates.values()
        return (
            1
            + sum(walk(child) for child in node.layout)
            + sum(walk(template) for template in templates)
        )

    return int(walk(document.root))


def check(dist: Path = DIST) -> list[str]:
    """返回产物问题；空列表表示通过。"""
    manifest_path = dist / "tree" / "manifest.json"
    if not manifest_path.is_file():
        return [f"找不到 {manifest_path}（先跑 pnpm --dir app/ui-engine build）"]
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        return [f"manifest 读不了: {error}"]
    if not isinstance(manifest, dict):
        return ["manifest 必须是对象"]
    problems: list[str] = []
    if manifest.get("format") != FORMAT:
        problems.append(f"manifest.format 必须是 {FORMAT}")
    pages = manifest.get("pages")
    if not isinstance(pages, list) or not pages:
        return [*problems, "manifest.pages 必须是非空数组"]
    names: list[str] = []
    expected_files: set[str] = set()
    for index, entry in enumerate(pages):
        if not isinstance(entry, dict):
            problems.append(f"pages[{index}] 必须是对象")
            continue
        name = entry.get("name")
        if isinstance(name, str):
            names.append(name)
        file = entry.get("file")
        if isinstance(file, str):
            expected_files.add(Path(file).name)
        problems.extend(_problems_of_entry(entry, f"pages[{index}]", dist))
    if manifest.get("default") not in names:
        problems.append("manifest.default 必须是 pages 里的一个 name")
    pages_dir = dist / "tree" / "pages"
    actual_files = {path.name for path in pages_dir.glob("*.json")} if pages_dir.is_dir() else set()
    if actual_files != expected_files:
        problems.append(f"pages 目录与 manifest 不一致: {sorted(actual_files ^ expected_files)}")
    return problems


def main() -> int:
    problems = check()
    if problems:
        print("FAIL tree.artifacts")
        for problem in problems:
            print(f"  {problem}")
        return 1
    print("PASS tree.artifacts")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
