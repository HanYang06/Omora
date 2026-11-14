"""启动骨架：把系统插件在空数据下画出来的每一页冻成 Slot 视图模块。

编的是结构，不编数据：空 store 下每一页长什么样。运行时首帧先用它，连上后端再换成真视图。
链接不在这里做——TS 构建期用同一份局部树链接器（组合只有一份，在 TS）。

    uv run python scripts/static_ui.py            # 重写产物
    uv run python scripts/static_ui.py --check    # 只校验是否最新（CI）
"""

from __future__ import annotations

import argparse
import copy
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

OUT = ROOT / "app" / "ui-engine" / "src" / "generated" / "static-view.ts"

KEEP_EVENTS_KINDS = frozenset({"dendro:page-link"})
"""导航入口保留 handler id：旧壳骨架里导航看起来可用（只是还没挂监听）；
内容按钮没有 handler、画成禁用态，等真视图来了再换。"""


def strip_events(slot: dict[str, Any]) -> dict[str, Any]:
    """本地树 Slot → 骨架 Slot：摘掉 handler id（导航入口例外），children / 模板递归。"""
    node = {key: value for key, value in slot.items() if key != "events"}
    if slot.get("kind") in KEEP_EVENTS_KINDS:
        events = slot.get("events")
        if isinstance(events, dict) and events:
            node["events"] = dict(events)
    node["children"] = [strip_events(child) for child in slot.get("children") or []]
    collection = slot.get("collection")
    if isinstance(collection, dict):
        templates = collection.get("templates")
        if isinstance(templates, dict):
            node["collection"] = {
                **collection,
                "templates": {name: strip_events(item) for name, item in templates.items()},
            }
    return node


def skeleton_view(view: dict[str, Any]) -> dict[str, Any]:
    """一份 view → 首帧骨架：版本归一为 1（骨架没有数据版本），摘事件。"""
    plain = copy.deepcopy(view)
    plain["version"] = 1
    trees = plain["localTrees"]["trees"]
    plain["localTrees"]["seq"] = 1
    for tree in trees:
        tree["root"] = strip_events(tree["root"])
    return plain


def collect(kernel: Any) -> dict[str, dict[str, Any]]:
    """把每一页画一遍（slot 出口），收成 name → 首帧视图。"""
    ui = kernel.resolve("ui")
    first = ui.render(engine="slot")
    names = [str(page["id"]).removeprefix("page.") for page in first["pages"]]
    views: dict[str, dict[str, Any]] = {}
    for name in names:
        views[name] = skeleton_view(ui.render(name, engine="slot"))
    return {name: views[name] for name in names}


def hash_of(views: dict[str, dict[str, Any]]) -> str:
    """构建哈希：页面 / 结构一变就变；客户端拿它判断骨架是不是这一版。"""
    raw = json.dumps(views, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:12]


def render_module(views: dict[str, dict[str, Any]]) -> str:
    names = list(views)
    lines = [
        "/** 生成物：启动骨架（每页一份 Slot 视图）。别手改——重跑 scripts/static_ui.py。 */",
        "",
        f'export const STATIC_HASH = "{hash_of(views)}";',
        "",
        "export const STATIC_ORDER = [",
        *[f'  "{name}",' for name in names],
        "] as const;",
        "",
        "/** 每页的首帧视图；build 期用 parseView 校验后交给 TS 链接器。 */",
        "export const STATIC_VIEWS: Record<string, unknown> = {",
        *[
            f"  {json.dumps(name)}: {json.dumps(view, ensure_ascii=False)},"
            for name, view in views.items()
        ],
        "};",
        "",
    ]
    return "\n".join(lines)


def build_views() -> dict[str, dict[str, Any]]:
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

    views = build_views()
    expected = render_module(views)
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
    print(f"WROTE {len(views)} pages")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
