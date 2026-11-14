"""构建产物门禁的行为测试。"""

from __future__ import annotations

from skeleton_html import check

COMPILED = (
    '<body><div id="root">'
    '<div class="omora-row" data-type="dendro:window" data-dendro-layout="slot">'
    '<div data-type="dendro:page-link"></div>'
    "</div></div></body>"
)


def test_accepts_compiled_skeleton() -> None:
    assert check(COMPILED) == []


def test_rejects_empty_root() -> None:
    problems = check('<div id="root"></div>')
    assert any("#root" in problem for problem in problems)


def test_rejects_shell_without_nav() -> None:
    html = COMPILED.replace('data-type="dendro:page-link"', 'data-type="dendro:link"')
    assert any("导航" in problem for problem in check(html))


def test_rejects_missing_layout_marker() -> None:
    html = COMPILED.replace('data-dendro-layout="slot"', 'data-dendro-layout="legacy"')
    assert any("布局标记" in problem for problem in check(html))
