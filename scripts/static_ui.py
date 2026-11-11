"""启动骨架：把系统插件在空数据下渲染出来的视图冻结成模块。

编的是结构，不编数据：空 store 下每一页长什么样。运行时先画它，连上后端再换成真的。
组合不在这里做——客户端启动时拿这些快照自己组合（组合器只有一份，在 TS）。

    uv run python scripts/static_ui.py            # 重写产物
    uv run python scripts/static_ui.py --check    # 只校验是否最新（CI）
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "app"))

from boot import Config, build  # noqa: E402
from main import SYSTEM_PLUGINS  # noqa: E402

OUT = ROOT / "app" / "ui-engine" / "src" / "generated" / "static-tree.ts"

HANDLERS = ("on_click", "on_submit", "on_query", "on_pick", "on_press", "on_release", "on_change")
"""回调先摘掉：骨架只用来先画出来，这时候按钮按了也没人接。"""

NODE_KEYS = ("type", "props", "children")


def strip_handlers(node: dict[str, Any]) -> dict[str, Any]:
    """摘掉回调 id，保留结构与文案；按钮因此画成禁用，等真快照来了再说。"""
    props = {key: value for key, value in node["props"].items() if key not in HANDLERS}
    children = [strip_handlers(child) for child in node.get("children") or []]
    return {"type": node["type"], "props": props, "children": children}


def plain(snapshot: dict[str, Any]) -> dict[str, Any]:
    """快照 → 骨架的一页：去掉数据性字段（meta），摘掉回调。"""
    page: dict[str, Any] = {
        "pages": snapshot["pages"],
        "page": snapshot["page"],
        "meta": "",
        "content": strip_handlers(snapshot["content"]),
        "version": snapshot["version"],
    }
    contributions = snapshot.get("contributions") or []
    if contributions:
        page["contributions"] = [
            {**item, "tree": strip_handlers(item["tree"])} for item in contributions
        ]
    topics = snapshot.get("topics") or []
    if topics:
        page["topics"] = topics
    return page


def collect(kernel: Any) -> dict[str, dict[str, Any]]:
    """把每一页画一遍，收成 name → 骨架。"""
    ui = kernel.resolve("ui")
    first = ui.render()
    pages = [str(page["name"]) for page in first["pages"]]
    snapshots = {str(first["page"]): plain(first)}
    for name in pages:
        if name not in snapshots:
            snapshots[name] = plain(ui.render(name))
    return {name: snapshots[name] for name in pages}


def hash_of(snapshots: dict[str, dict[str, Any]]) -> str:
    """构建哈希：导航与页面名一变就变；客户端拿它判断骨架是不是这一版。"""
    pages = [snapshot["pages"] for snapshot in snapshots.values()]
    raw = json.dumps(pages, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:12]


def render_module(snapshots: dict[str, dict[str, Any]]) -> str:
    names = list(snapshots)
    lines = [
        "/** 生成物：启动骨架。别手改——跑 `uv run python scripts/static_ui.py`。 */",
        'import type { Snapshot } from "../core/types";',
        "",
        f'export const STATIC_HASH = "{hash_of(snapshots)}";',
        "",
        "export const STATIC_ORDER = [",
        *[f'  "{name}",' for name in names],
        "] as const;",
        "",
        "export const STATIC_SNAPSHOTS: Record<string, Snapshot> = {",
        *[
            f"  {json.dumps(name)}: {json.dumps(snapshot, ensure_ascii=False)},"
            for name, snapshot in snapshots.items()
        ],
        "};",
        "",
    ]
    return "\n".join(lines)


def build_snapshots() -> dict[str, dict[str, Any]]:
    """空数据下跑一遍系统插件：一个临时 store，不落任何用户数据。"""
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        root = Path(tmp)
        config = Config(
            {
                "store": {"path": str(root / "omora.db")},
                "media": {"root": str(root / "media")},
            }
        )
        kernel = build(config, SYSTEM_PLUGINS)
        try:
            return collect(kernel)
        finally:
            # Windows 上 SQLite 的文件句柄要先关，临时目录才删得掉。
            for name in reversed(kernel.names()):
                kernel.uninstall(name)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="生成启动骨架模块")
    parser.add_argument("--check", action="store_true", help="只校验产物是否最新，不写")
    args = parser.parse_args(argv)

    snapshots = build_snapshots()
    expected = render_module(snapshots)
    if args.check:
        actual = OUT.read_text(encoding="utf-8") if OUT.exists() else None
        if actual != expected:
            print("FAIL static")
            print("  跑 uv run python scripts/static_ui.py 重新生成")
            return 1
        print("PASS static")
        return 0

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(expected, encoding="utf-8", newline="\n")
    print(f"WROTE {len(snapshots)} pages")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
