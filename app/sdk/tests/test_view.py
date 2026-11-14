"""主会话 view 线上形状：Python 序列化必须与跨语言 fixture 完全一致。"""

from __future__ import annotations

import json
from collections.abc import Callable
from itertools import count
from pathlib import Path
from typing import Any

import pytest

from omora.sdk.document import DocumentError, Layout, PageEntry, Slot
from omora.sdk.local_tree import LocalTree
from omora.sdk.view import serialize_view

_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "view.json"
_DATA: dict[str, Any] = json.loads(_FIXTURE.read_text(encoding="utf-8"))


def _noop(_payload: dict[str, Any]) -> None:
    pass


def _sequential_register() -> Callable[[Any], str]:
    counter = count()

    def register(_handler: Any) -> str:
        return f"h{next(counter)}"

    return register


def _nav_tree() -> LocalTree:
    root = Slot(
        "ui.nav",
        "dendro:slot",
        owner="ui",
        layout=Layout(flow="column", capacity="many"),
        children=[
            Slot(
                "ui.nav.ideas",
                "dendro:page-link",
                owner="ui",
                props={"label": "灵感", "icon": "ideas"},
                events={"click": _noop},
            ),
            Slot(
                "ui.nav.projects",
                "dendro:page-link",
                owner="ui",
                props={"label": "项目", "icon": "projects"},
                events={"click": _noop},
            ),
        ],
    )
    return LocalTree(owner="ui", root=root, mount_at="dendro.window.nav")


def _page_tree() -> LocalTree:
    root = Slot(
        "page.ideas",
        "dendro:page",
        owner="ideas",
        props={"label": "灵感", "icon": "ideas"},
        layout=Layout(flow="column", capacity="many"),
        children=[
            Slot(
                "page.ideas.title",
                "dendro:text",
                owner="ideas",
                props={"text": "灵感", "kind": "title"},
            )
        ],
    )
    return LocalTree(owner="ideas", root=root, mount_at="dendro.window.page")


def _pages() -> list[PageEntry]:
    return [
        PageEntry("page.ideas", "灵感", route="/ideas", owner="ideas", icon="ideas"),
        PageEntry("page.projects", "项目", route="/projects", owner="projects", icon="projects"),
    ]


def _view(**overrides: object) -> dict[str, Any]:
    arguments: dict[str, Any] = {
        "trees": [_nav_tree(), _page_tree()],
        "pages": _pages(),
        "active": "page.ideas",
        "data": {},
        "register": _sequential_register(),
        "version": 1,
    }
    arguments.update(overrides)
    return serialize_view(**arguments)


def test_view_matches_shared_fixture() -> None:
    assert _view() == _DATA


def test_view_version_must_be_positive_int() -> None:
    with pytest.raises(DocumentError, match="version"):
        _view(version=0)
    with pytest.raises(DocumentError, match="version"):
        _view(version=True)


def test_view_active_must_be_known_page() -> None:
    with pytest.raises(DocumentError, match="active"):
        _view(active="page.detail")


def test_view_pages_must_be_unique() -> None:
    pages = [_pages()[0], PageEntry("page.ideas", "重复", route="/x", owner="x")]
    with pytest.raises(DocumentError, match="重复页面"):
        _view(pages=pages)


def test_view_data_must_be_mapping() -> None:
    with pytest.raises(DocumentError, match="data"):
        _view(data=[])
