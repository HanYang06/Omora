"""端到端冒烟：真内核、真插件、真 Slot 通道，一次跑通。

不起桌面壳（Electron 二进制不一定在），也不起浏览器：
把系统插件真装一遍，走"首页 → 点文字块 → 输一条 → 画出来"这条链，
再对一下静态骨架和运行时视图是不是同一份。CI 的 build job 会跑它。
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "app"))

import static_ui  # noqa: E402

from boot import Config, build  # noqa: E402
from main import SYSTEM_PLUGINS  # noqa: E402


def walk(slot: dict[str, Any]) -> list[dict[str, Any]]:
    found = [slot]
    for child in slot.get("children") or []:
        found.extend(walk(child))
    return found


def page_slots(view: dict[str, Any]) -> list[dict[str, Any]]:
    for tree in view["localTrees"]["trees"]:
        if tree["mountAt"] == "dendro.window.page":
            return walk(tree["root"])
    raise AssertionError("view 里没有页面局部树")


def find_slot(view: dict[str, Any], kind: str, **props: Any) -> dict[str, Any] | None:
    for slot in page_slots(view):
        if slot.get("kind") != kind:
            continue
        if all(slot.get("props", {}).get(key) == value for key, value in props.items()):
            return slot
    return None


def run() -> int:
    """返回 0 表示冒烟通过；断言失败直接抛。"""
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
            ui: Any = kernel.resolve("ui")
            first = ui.render()
            names = [str(page["id"]).removeprefix("page.") for page in first["pages"]]
            assert names, "一页都没登记"
            print(f"PASS pages {names}")

            views = {name: ui.render(name) for name in names}
            assert all(view["kind"] == "view" for view in views.values())
            print("PASS every page has a view")

            # 事件只在最近一代 handler 里有效：先重画当前页再取 handler。
            current = ui.render("ideas")
            tile = find_slot(current, "dendro:tile", title="文字")
            assert tile is not None, "首页应该有文字捕捉块"
            handler = str(tile["events"]["click"])
            ui.event(handler, {})

            opened = ui.render("ideas")
            box = find_slot(opened, "dendro:input")
            assert box is not None, "点开文字块之后应该有输入框"
            submit = str(box["events"]["submit"])

            after = ui.event(submit, {"value": "买牛奶"})
            assert "买牛奶" in json.dumps(after, ensure_ascii=False)
            assert after["version"] > views["ideas"]["version"]
            print("PASS capture flow", submit)

            built = static_ui.build_views()
            assert list(built) == names, "静态骨架的页与运行时不一致"
            runtime = {name: static_ui.skeleton_view(views[name]) for name in names}
            assert static_ui.hash_of(built) == static_ui.hash_of(runtime), (
                "静态骨架与运行时视图不一致"
            )
            print(f"PASS static matches runtime {static_ui.hash_of(built)}")
        finally:
            for name in reversed(kernel.names()):
                kernel.uninstall(name)
    print("SMOKE OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
