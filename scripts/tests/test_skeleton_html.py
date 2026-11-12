"""构建产物门禁的行为测试。"""

from __future__ import annotations

from skeleton_html import check

COMPILED = (
    '<body><div id="root">'
    '<div class="omora-app" data-connection="idle">'
    '<nav class="omora-shell-nav"></nav>'
    "</div></div></body>"
)


def test_accepts_compiled_skeleton() -> None:
    assert check(COMPILED) == []


def test_rejects_empty_root() -> None:
    problems = check('<div id="root"></div>')
    assert any("#root" in problem for problem in problems)


def test_rejects_shell_without_nav() -> None:
    html = COMPILED.replace('class="omora-shell-nav"', 'class="omora-shell-other"')
    assert any("导航栏" in problem for problem in check(html))


def test_rejects_wrong_status() -> None:
    html = COMPILED.replace('data-connection="idle"', 'data-connection="open"')
    assert any("未连接" in problem for problem in check(html))
