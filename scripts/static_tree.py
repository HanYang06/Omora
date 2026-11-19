"""构建期 V1 树输入：空数据下把每个页面转成 base + 局部树，写进 generated/static-tree.json。

    uv run python scripts/static_tree.py            # 重写产物
    uv run python scripts/static_tree.py --check    # 只校验是否最新（CI）

Vite 构建期把这份输入 compose 成每页一份 `dendro.tree/1` 文档，放进 `dist/tree/`。
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "app"))

from boot import Config, build  # noqa: E402
from main import SYSTEM_PLUGINS  # noqa: E402
from omora.core.kernel import Kernel  # noqa: E402
from omora.sdk.tree_build import FORMAT, NavEntry, build_page  # noqa: E402

OUT = ROOT / "app" / "ui-engine" / "src" / "generated" / "static-tree.json"


@contextmanager
def system_kernel() -> Iterator[Kernel]:
    """空数据跑一遍系统插件：临时 store，不落用户数据；退出时按逆序卸载。"""
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
            yield kernel
        finally:
            # Windows 上 SQLite 的文件句柄要先关，临时目录才删得掉。
            for name in reversed(kernel.names()):
                kernel.uninstall(name)


def collect(kernel: Kernel) -> dict[str, Any]:
    """每一页：内容树 → base + 导航 / 内容局部树；返回整份构建输入。"""
    ui = kernel.resolve("ui")
    listing = ui.pages()
    if not listing:
        raise LookupError("没有登记任何页面")
    entries = [NavEntry(name=item.name, title=item.label, icon=item.icon) for item in listing]
    pages = [
        build_page(
            name=entry.name,
            title=entry.title,
            route=f"/{entry.name}",
            page=ui.page_tree(entry.name),
            owner=item.owner,
            nav=entries,
        )
        for item, entry in zip(listing, entries, strict=True)
    ]
    return {"format": FORMAT, "default": entries[0].name, "pages": pages}


def render_file(payload: dict[str, Any]) -> str:
    """构建输入 → 提交进仓库的 JSON：确定性缩进 + 结尾换行。"""
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="生成 V1 构建输入")
    parser.add_argument("--check", action="store_true", help="只校验产物是否最新，不写")
    args = parser.parse_args(argv)

    with system_kernel() as kernel:
        payload = collect(kernel)

    expected = render_file(payload)
    if args.check:
        actual = OUT.read_text(encoding="utf-8") if OUT.exists() else None
        if actual != expected:
            print("FAIL static-tree")
            print("  跑 uv run python scripts/static_tree.py 重新生成")
            return 1
        print("PASS static-tree")
        return 0

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(expected, encoding="utf-8", newline="\n")
    names = [page["name"] for page in payload["pages"]]
    print(f"WROTE {len(names)} pages: {', '.join(names)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
