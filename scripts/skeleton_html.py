"""构建产物门禁：确认 Vite 把 Slot 启动骨架编译进了 index.html。

和 `static_ui.py --check` 分工：那边查源码里的骨架视图是否最新；这边查构建产物里确实有
编译后的首帧 HTML——Vite adapter 真的接上了，而不是只生成了数据。
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "app" / "ui-engine" / "dist" / "index.html"

ROOT_OPEN = '<div id="root">'
WINDOW = 'data-type="dendro:window"'
LAYOUT = 'data-dendro-layout="slot"'
NAV_LINK = 'data-type="dendro:page-link"'


def check(html: str) -> list[str]:
    """返回产物问题；空列表表示通过。"""
    problems: list[str] = []
    if ROOT_OPEN + "<div" not in html:
        problems.append("#root 里没有编译出的 Slot 首帧")
    if WINDOW not in html:
        problems.append("骨架里没有 window 根（data-type=dendro:window）")
    if LAYOUT not in html:
        problems.append("骨架没有 Slot 布局标记（data-dendro-layout=slot）")
    if NAV_LINK not in html:
        problems.append("骨架里没有导航入口（dendro:page-link）")
    return problems


def main() -> int:
    if not INDEX.is_file():
        print("FAIL skeleton.html")
        print("  找不到 app/ui-engine/dist/index.html，先跑 pnpm --dir app/ui-engine build")
        return 1
    problems = check(INDEX.read_text(encoding="utf-8"))
    if problems:
        print("FAIL skeleton.html")
        for problem in problems:
            print(f"  {problem}")
        return 1
    print("PASS skeleton.html")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
