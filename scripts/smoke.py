"""端到端冒烟：真内核、真插件、真静态骨架，一次跑通。

不起桌面壳（Electron 二进制不一定在），也不起浏览器：
把系统插件真装一遍，走"首页 → 点文字块 → 输一条 → 画出来"这条链，
再对一下静态骨架和运行时结构是不是同一份。CI 的 build job 会跑它。
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


def find(node: dict[str, Any], node_type: str) -> dict[str, Any] | None:
    if node.get("type") == node_type:
        return node
    for child in node.get("children") or []:
        found = find(child, node_type)
        if found is not None:
            return found
    return None


def find_tile(node: dict[str, Any], title: str) -> dict[str, Any] | None:
    if node.get("type") == "tile" and node.get("props", {}).get("title") == title:
        return node
    for child in node.get("children") or []:
        found = find_tile(child, title)
        if found is not None:
            return found
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
            pages = [str(page["name"]) for page in first["pages"]]
            assert pages, "一页都没登记"
            print(f"PASS pages {pages}")

            snapshots = {name: ui.render(name) for name in pages}
            assert all("content" in snapshot for snapshot in snapshots.values())
            print("PASS every page has a tree")

            tile = find_tile(snapshots["ideas"]["content"], "文字")
            assert tile is not None, "首页应该有文字捕捉块"
            ui.event(str(tile["props"]["on_click"]), {})

            opened = ui.render("ideas")
            box = find(opened["content"], "input")
            assert box is not None, "点开文字块之后应该有输入框"
            handler = str(box["props"]["on_submit"])

            assert ui.event(handler, {"value": "买牛奶"}) == {}
            after = ui.render("ideas")
            assert "买牛奶" in json.dumps(after, ensure_ascii=False)
            assert after["version"] > snapshots["ideas"]["version"]
            print("PASS capture flow", handler)

            built = static_ui.build_snapshots()
            assert list(built) == pages, "静态骨架的页与运行时不一致"
            plain = {name: static_ui.plain(snapshots[name]) for name in pages}
            assert static_ui.hash_of(built) == static_ui.hash_of(plain), (
                "静态骨架与运行时结构不一致"
            )
            print(f"PASS static matches runtime {static_ui.hash_of(built)}")
        finally:
            for name in reversed(kernel.names()):
                kernel.uninstall(name)
    print("SMOKE OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
