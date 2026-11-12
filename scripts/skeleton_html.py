"""构建产物门禁：确认 Vite 把启动骨架编译进了 index.html。

和 `static_ui.py --check` 分工：那边查源码里的骨架数据是否最新；这边查构建产物里
确实有编译后的首帧 HTML——Vite adapter 真的接上了，而不是只生成了数据。
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "app" / "ui-engine" / "dist" / "index.html"

ROOT_OPEN = '<div id="root">'
APP_OPEN = '<div class="omora-app"'


def check(html: str) -> list[str]:
    """返回产物问题；空列表表示通过。"""
    problems: list[str] = []
    if ROOT_OPEN + APP_OPEN not in html:
        problems.append("#root 里没有编译出的 omora-app 骨架")
    if 'class="omora-shell-nav"' not in html:
        problems.append("骨架里没有导航栏（omora-shell-nav）")
    if 'data-connection="idle"' not in html:
        problems.append("骨架没有停在未连接状态（data-connection）")
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
