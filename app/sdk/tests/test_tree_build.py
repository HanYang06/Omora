"""构建期 V1 树：base 文档 / 局部树 / 确定性 id 的行为。"""

from __future__ import annotations

import json
import re
from typing import Any

import pytest

from omora.sdk.tree import parse_document, parse_partial
from omora.sdk.tree_build import (
    NavEntry,
    base_document,
    build_page,
    compose,
    content_partial,
    nav_partials,
    tree_id,
)
from omora.sdk.ui import Button, Column, Page, Text

HEX16 = re.compile(r"^[0-9a-f]{16}$")


def _walk(node: dict[str, Any]) -> list[dict[str, Any]]:
    found = [node]
    for child in node["layout"]:
        found.extend(_walk(child))
    return found


def _ids(document: dict[str, Any]) -> list[str]:
    return [node["id"] for node in _walk(document["root"])]


def _page_node(document: dict[str, Any]) -> dict[str, Any]:
    page_id = document["active"]
    return next(node for node in _walk(document["root"]) if node["id"] == page_id)


def _page_page() -> Page:
    def click(_payload: dict[str, Any]) -> None:
        return None

    return Page(Column(Text("标题", kind="title"), Button("按一下", on_click=click)))


def test_tree_id_is_stable_and_16_hex() -> None:
    first = tree_id("omora.tree/root")
    second = tree_id("omora.tree/root")

    assert HEX16.fullmatch(first)
    assert first == second
    assert first != tree_id("omora.tree/nav")
    with pytest.raises(ValueError, match="非空"):
        tree_id("")


def test_base_document_is_a_valid_document_with_one_page() -> None:
    document = base_document(name="ideas", title="灵感", route="/ideas")

    parsed = parse_document(document)

    assert parsed.root.kind == "app"
    assert [page.title for page in parsed.pages] == ["灵感"]
    assert parsed.active == parsed.pages[0].id
    page_node = _page_node(document)
    assert page_node["kind"] == "column"
    assert page_node["layout"] == []
    root_orders = [child["order"] for child in document["root"]["layout"]]
    assert root_orders == sorted(set(root_orders))


def test_content_partial_mounts_into_the_page_container() -> None:
    partial = content_partial(_page_page(), name="ideas", owner="ideas")

    parsed = parse_partial(partial)

    page = base_document(name="ideas", title="灵感", route="/ideas")
    page_id = _page_node(page)["id"]
    assert partial["mount"] == {"parent": page_id, "mode": "new"}
    assert parsed.source == "ideas"
    expected_chain = f"{_page_node(page)['chain']}.{partial['root']['id']}"
    assert partial["root"]["chain"] == expected_chain
    # callable 字段不进 settings，也不进 on（运行时再绑）
    assert "on_click" not in partial["root"]["layout"][1]["settings"]
    assert partial["root"]["layout"][1]["on"] == {}
    assert [child["order"] for child in partial["root"]["layout"]] == [10, 20]


def test_nav_partials_mark_only_the_active_page() -> None:
    entries = [
        NavEntry("ideas", "灵感", "ideas"),
        NavEntry("projects", "项目", None),
    ]

    partials = nav_partials(entries, active="projects")

    assert [partial["mount"]["parent"] for partial in partials] == [
        partials[0]["mount"]["parent"]
    ] * 2
    parsed = [parse_partial(partial) for partial in partials]
    assert [entry.source for entry in parsed] == ["ui", "ui"]
    settings = [partial["root"]["settings"] for partial in partials]
    assert [setting["active"] for setting in settings] == [False, True]
    assert [setting["route"] for setting in settings] == ["/ideas", "/projects"]
    assert "icon" not in settings[1]
    assert [partial["root"]["order"] for partial in partials] == [10, 20]


def test_nav_partials_reject_duplicate_pages() -> None:
    with pytest.raises(ValueError, match="重复导航页面"):
        nav_partials([NavEntry("ideas", "灵感"), NavEntry("ideas", "又一个")], active="ideas")


def test_build_page_packages_base_and_all_partials() -> None:
    entries = [NavEntry("ideas", "灵感"), NavEntry("projects", "项目")]

    page = build_page(
        name="ideas",
        title="灵感",
        route="/ideas",
        page=_page_page(),
        owner="ideas",
        nav=entries,
    )

    assert (page["name"], page["title"], page["route"]) == ("ideas", "灵感", "/ideas")
    assert len(page["partials"]) == len(entries) + 1
    assert page["partials"][-1]["source"] == "ideas"
    parse_document(page["base"])
    for partial in page["partials"]:
        parse_partial(partial)


def test_compose_mounts_nav_and_content_into_one_document() -> None:
    base = base_document(name="ideas", title="灵感", route="/ideas")
    nav = nav_partials([NavEntry("ideas", "灵感"), NavEntry("projects", "项目")], active="ideas")
    content = content_partial(_page_page(), name="ideas", owner="ideas")

    document = compose(base, [*nav, content])

    parsed = parse_document(document)
    assert parsed.root.kind == "app"
    page_node = _page_node(document)
    assert [child["kind"] for child in page_node["layout"]] == ["column"]
    nav_node = next(
        node for node in _walk(document["root"]) if node["id"] == nav[0]["mount"]["parent"]
    )
    assert [child["settings"]["route"] for child in nav_node["layout"]] == [
        "/ideas",
        "/projects",
    ]
    assert [child["order"] for child in nav_node["layout"]] == [10, 20]


def test_compose_rejects_missing_parent_and_duplicate_ids() -> None:
    base = base_document(name="ideas", title="灵感", route="/ideas")
    content = content_partial(_page_page(), name="ideas", owner="ideas")

    missing = {"mount": {"parent": "0" * 16, "mode": "new"}, "root": content["root"]}
    with pytest.raises(ValueError, match="父节点不存在"):
        compose(base, [missing])

    with pytest.raises(ValueError, match="节点 id 重复"):
        compose(base, [content, content])


def test_rebuilding_the_same_page_gives_the_same_input() -> None:
    entries = [NavEntry("ideas", "灵感")]

    def build() -> str:
        return json.dumps(
            build_page(
                name="ideas",
                title="灵感",
                route="/ideas",
                page=_page_page(),
                owner="ideas",
                nav=entries,
            ),
            ensure_ascii=False,
            sort_keys=True,
        )

    assert build() == build()
