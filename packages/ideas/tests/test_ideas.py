from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import omora.ideas as ideas_page
from omora.audio import AudioPlugin
from omora.core.kernel import Kernel
from omora.ideas import IdeasPlugin
from omora.media import MediaPlugin
from omora.store import StorePlugin
from omora.ui import UiPlugin
from omora.video import VideoPlugin

CHANNEL = "http://127.0.0.1:8766/media"
PAGE_MOUNT_AT = "dendro.window.page"


class _Net:
    """net 的替身：提供媒体通道地址，吞掉推送。"""

    name = "net"

    def __init__(self, media_url: str = CHANNEL) -> None:
        self.media_url = media_url

    def apply(self, ctx: Any) -> None:
        ctx.provide("net", self)

    def emit(self, topic: str, payload: dict[str, Any], *, coalesce: bool = False) -> None:
        pass


def _kernel(tmp_path: Path, *, captures: bool = True) -> Kernel:
    kernel = Kernel()
    kernel.install(StorePlugin(path=str(tmp_path / "omora.db")))
    kernel.install(MediaPlugin(root=str(tmp_path / "media")))
    kernel.install(UiPlugin())
    if captures:
        kernel.install(AudioPlugin())
        kernel.install(VideoPlugin())
        kernel.install(_Net())
    kernel.install(IdeasPlugin())
    return kernel


def _find_tree_node(node: dict[str, Any], node_id: str) -> dict[str, Any] | None:
    if node["id"] == node_id:
        return node
    for child in node["layout"]:
        found = _find_tree_node(child, node_id)
        if found is not None:
            return found
    for template in node.get("collection", {}).get("templates", {}).values():
        found = _find_tree_node(template, node_id)
        if found is not None:
            return found
    return None


def _as_slot(node: dict[str, Any]) -> dict[str, Any]:
    """V1 节点 → 测试视图节点（kind / props / events / children）。"""
    return {
        "kind": "dendro:" + str(node["kind"]),
        "props": dict(node["settings"]),
        "events": dict(node["on"]),
        "children": [_as_slot(child) for child in node["layout"]],
    }


def _adapt_tree(ui: Any, frame: dict[str, Any] | None = None) -> dict[str, Any]:
    """把 ui 当前这棵树摊成旧 view 形状，测试体只认页面内容。"""
    document = ui.current_document
    if document is None:
        raise AssertionError("tree 还没构建")
    page = _find_tree_node(document["root"], document["active"])
    if page is None:
        raise AssertionError("tree 里没有 active 页")
    pages = [
        {
            "id": "page." + info.name,
            "label": info.label,
            "route": "/" + info.name,
            "owner": info.owner,
            "icon": info.icon,
        }
        for info in ui.pages()
    ]
    active = ui.active_page
    return {
        "kind": "view",
        "version": (1 if frame is None or "document" not in frame else int(frame["document"])),
        "frame": frame,
        "active": None if active is None else "page." + active,
        "pages": pages,
        "localTrees": {
            "trees": [
                {
                    "mountAt": PAGE_MOUNT_AT,
                    "root": {
                        "kind": "dendro:page",
                        "props": {},
                        "events": {},
                        "children": [_as_slot(page["layout"][0])],
                    },
                }
            ]
        },
    }


def _tree_view(ui: Any, page: str | None = None) -> dict[str, Any]:
    """整页兜底：重建当前页（或指定页）。"""
    if page is None:
        ui.tree()
    else:
        ui.tree(page)
    return _adapt_tree(ui)


def _fire(ui: Any, handler: Any, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """发一次事件：回包是 ops 帧，随后把这次重建的树摊成测试视图。"""
    frame = ui.tree_event(str(handler), payload or {})
    return _adapt_tree(ui, frame)


def _walk(slot: dict[str, Any]) -> list[dict[str, Any]]:
    found = [slot]
    for child in slot["children"]:
        found.extend(_walk(child))
    return found


def _page_root(view: dict[str, Any]) -> dict[str, Any]:
    for tree in view["localTrees"]["trees"]:
        if tree["mountAt"] == PAGE_MOUNT_AT:
            return dict(tree["root"])
    raise AssertionError("view 里没有页面局部树")


def _content(view: dict[str, Any]) -> dict[str, Any]:
    return dict(_page_root(view)["children"][0])


def _kind(slot: dict[str, Any]) -> str:
    return str(slot["kind"]).removeprefix("dendro:")


def _nodes(node: dict[str, Any], node_type: str) -> list[dict[str, Any]]:
    return [slot for slot in _walk(node) if _kind(slot) == node_type]


def _split(view: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    content = _content(view)
    assert _kind(content) == "split", f"页面要是 Split，实际是 {_kind(content)}"
    side, main = content["children"]
    return dict(side), dict(main)


def _rail(view: dict[str, Any]) -> dict[str, Any]:
    side, _ = _split(view)
    assert _kind(side) == "rail", f"第一栏要是 Rail，实际是 {_kind(side)}"
    return side


def _main(view: dict[str, Any]) -> dict[str, Any]:
    return _split(view)[1]


def _titles(node: dict[str, Any], node_type: str) -> list[str]:
    return [str(child["props"]["title"]) for child in _nodes(node, node_type)]


def _rail_titles(view: dict[str, Any]) -> list[str]:
    return _titles(_rail(view), "item")


def _cards(view: dict[str, Any]) -> list[str]:
    return _titles(_main(view), "card")


def _tiles(view: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(node["props"]["title"]): node for node in _nodes(_main(view), "tile")}


def _chips(view: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(node["props"]["text"]): node for node in _nodes(_main(view), "chip")}


def _active_chips(view: dict[str, Any]) -> list[str]:
    return [text for text, node in _chips(view).items() if node["props"]["active"]]


def _search_node(view: dict[str, Any]) -> dict[str, Any]:
    return _nodes(_main(view), "search")[0]


def _heading(view: dict[str, Any]) -> str:
    headings = [
        node["props"]["text"]
        for node in _nodes(_main(view), "text")
        if node["props"].get("kind") == "title"
    ]
    assert headings, "主区里没有标题"
    return str(headings[0])


def _click_tile(ui: Any, title: str) -> Any:
    return _fire(ui, _tiles(_tree_view(ui))[title]["events"]["click"])


def _click_chip(ui: Any, text: str) -> Any:
    return _fire(ui, _chips(_tree_view(ui))[text]["events"]["click"])


def _click_button(ui: Any, text: str) -> Any:
    hits = [
        node for node in _nodes(_main(_tree_view(ui)), "button") if node["props"]["text"] == text
    ]
    assert hits, f"主区里没有按钮: {text}"
    return _fire(ui, hits[0]["events"]["click"])


def _open_rail(ui: Any, title: str) -> Any:
    hits = [row for row in _nodes(_rail(_tree_view(ui)), "item") if row["props"]["title"] == title]
    assert hits, f"索引栏里没有: {title}"
    return _fire(ui, hits[0]["events"]["click"])


def _pin(ui: Any, title: str) -> Any:
    _open_rail(ui, title)
    _click_button(ui, "置顶")
    return _click_button(ui, "← 返回")


def _capture_text(ui: Any, value: str) -> Any:
    _click_tile(ui, "文字")
    field = _nodes(_main(_tree_view(ui)), "input")[0]
    return _fire(ui, field["events"]["submit"], {"value": value})


def _type(ui: Any, value: str) -> Any:
    return _fire(ui, _search_node(_tree_view(ui))["events"]["query"], {"value": value})


def _submit(ui: Any, value: str) -> Any:
    return _fire(ui, _search_node(_tree_view(ui))["events"]["submit"], {"value": value})


def test_the_page_is_a_split_of_a_rail_and_a_main_area_with_the_ideas_icon(
    tmp_path: Path,
) -> None:
    view = _tree_view(_kernel(tmp_path).resolve("ui"))

    side, main = _split(view)

    assert side["props"]["title"] == "全部灵感"
    assert _kind(main) == "column"
    assert view["pages"][0] == {
        "id": "page.ideas",
        "label": "灵感",
        "route": "/ideas",
        "owner": "ideas",
        "icon": "ideas",
    }


def test_the_home_is_three_regions_with_the_toolbar_and_feed_in_a_panel(
    tmp_path: Path,
) -> None:
    view = _tree_view(_kernel(tmp_path).resolve("ui"))
    main = _main(view)
    _, tiles_row, panel, hotkey = main["children"]

    assert [_kind(child) for child in main["children"]] == ["search", "row", "panel", "hotkey"]
    assert hotkey["props"]["key"] == "space"
    assert list(_tiles(view)) == ["录音", "视频", "文字"]
    assert all("hint" not in tile["props"] for tile in tiles_row["children"])
    assert list(_chips(view)) == ["全部", "置顶", "最近", "久未打开"]
    assert _active_chips(view) == ["全部"]
    assert [_kind(child) for child in panel["children"]] == ["row", "empty"]
    assert _nodes(panel, "chip")
    assert _nodes(panel, "tile") == []
    assert _nodes(panel, "empty")[0]["props"]["hint"] == "记下的第一条会出现在这里。"


def test_the_rail_lists_every_idea_newest_first_and_the_feed_sits_in_the_panel(
    tmp_path: Path,
) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    for title in ("牛奶 A", "牛奶 B", "写周报"):
        _capture_text(ui, title)

    view = _tree_view(ui)
    panel = _main(view)["children"][2]

    assert _rail_titles(view) == ["写周报", "牛奶 B", "牛奶 A"]
    assert _kind(panel) == "panel"
    assert _titles(panel, "card") == ["写周报", "牛奶 B", "牛奶 A"]


def test_the_rail_only_navigates_and_carries_no_actions(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _capture_text(ui, "买牛奶")

    rail = _rail(_tree_view(ui))

    assert _nodes(rail, "button") == []
    assert _nodes(rail, "item")[0]["events"]["click"]


def test_clicking_a_rail_row_opens_the_detail_and_back_returns_home(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _capture_text(ui, "买牛奶")

    detail = _open_rail(ui, "买牛奶")
    assert _heading(detail) == "买牛奶"

    home = _click_button(ui, "← 返回")
    assert _cards(home) == ["买牛奶"]


def test_the_feed_is_newest_first_and_pinning_moves_a_card_to_the_top(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    for title in ("牛奶 A", "牛奶 B", "写周报"):
        _capture_text(ui, title)

    assert _cards(_tree_view(ui)) == ["写周报", "牛奶 B", "牛奶 A"]

    home = _pin(ui, "牛奶 A")

    assert _cards(home) == ["牛奶 A", "写周报", "牛奶 B"]
    assert _rail_titles(home) == ["牛奶 A", "写周报", "牛奶 B"]


def test_the_pinned_chip_keeps_only_pinned_ideas(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _capture_text(ui, "牛奶 A")
    _capture_text(ui, "牛奶 B")
    _pin(ui, "牛奶 A")

    view = _click_chip(ui, "置顶")

    assert _cards(view) == ["牛奶 A"]
    assert _active_chips(view) == ["置顶"]


def test_the_recent_and_stale_chips_split_the_feed_by_age(tmp_path: Path, monkeypatch: Any) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _capture_text(ui, "牛奶 A")
    _capture_text(ui, "牛奶 B")

    assert _cards(_click_chip(ui, "最近")) == ["牛奶 B", "牛奶 A"]

    later = datetime.now() + timedelta(days=40)
    monkeypatch.setattr(ideas_page, "now", lambda: later)

    recent = _click_chip(ui, "最近")
    stale = _click_chip(ui, "久未打开")

    assert _cards(recent) == []
    assert _nodes(_main(recent), "empty")[0]["props"]["title"] == "最近 30 天没有新灵感。"
    assert _cards(stale) == ["牛奶 B", "牛奶 A"]
    assert _active_chips(stale) == ["久未打开"]


def test_the_detail_carries_the_pin_state_it_can_undo(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _capture_text(ui, "买牛奶")
    _open_rail(ui, "买牛奶")

    detail = _click_button(ui, "置顶")

    assert [node["props"]["text"] for node in _nodes(_main(detail), "button")] == [
        "← 返回",
        "取消置顶",
        "归档",
    ]


def test_archiving_from_the_detail_takes_the_idea_out_of_the_page(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _capture_text(ui, "牛奶 A")
    _capture_text(ui, "牛奶 B")
    _open_rail(ui, "牛奶 A")

    home = _click_button(ui, "归档")

    assert _cards(home) == ["牛奶 B"]
    assert _rail_titles(home) == ["牛奶 B"]


def test_the_page_table_lists_the_ideas_page(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")

    home = _capture_text(ui, "买牛奶")

    assert home["pages"][0]["label"] == "灵感"
    assert home["pages"][0]["id"] == "page.ideas"
    assert home["active"] == "page.ideas"


def test_typing_offers_suggestions_and_enter_moves_to_the_results(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _capture_text(ui, "买牛奶")
    _capture_text(ui, "牛奶要冷的")
    _capture_text(ui, "写周报")

    typed = _type(ui, "牛奶")

    assert _titles(_main(typed), "suggestion") == ["牛奶要冷的", "买牛奶"]
    assert _nodes(_main(typed), "result") == []
    assert _rail_titles(typed) == ["写周报", "牛奶要冷的", "买牛奶"]

    results = _submit(ui, "牛奶")

    assert _titles(_main(results), "result") == ["牛奶要冷的", "买牛奶"]
    assert _search_node(results)["props"]["value"] == "牛奶"
    assert _rail_titles(results) == ["写周报", "牛奶要冷的", "买牛奶"]


def test_the_dropdown_keeps_at_most_five_suggestions(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    for index in range(7):
        _capture_text(ui, f"牛奶 {index}")

    assert len(_titles(_main(_type(ui, "牛奶")), "suggestion")) == 5


def test_a_query_without_matches_offers_nothing_and_shows_the_empty_state(
    tmp_path: Path,
) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _capture_text(ui, "买牛奶")

    typed = _type(ui, "牛排")
    assert _titles(_main(typed), "suggestion") == []
    assert _nodes(_main(typed), "result") == []

    after = _submit(ui, "牛排")
    assert _nodes(_main(after), "empty")[0]["props"]["title"] == "没有匹配的灵感。"


def test_clicking_a_result_opens_the_detail_and_back_walks_home(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _capture_text(ui, "买牛奶")
    results = _submit(ui, "牛奶")
    hit = _nodes(_main(results), "result")[0]

    detail = _fire(ui, hit["events"]["click"])
    assert _heading(detail) == "买牛奶"

    back_to_results = _click_button(ui, "← 返回")
    assert _titles(_main(back_to_results), "result") == ["买牛奶"]

    home = _click_button(ui, "← 返回")
    assert _cards(home) == ["买牛奶"]
    assert _search_node(home)["props"]["value"] == "牛奶"


def test_a_result_carries_the_snippet_the_time_and_the_media_kind(tmp_path: Path) -> None:
    kernel = _kernel(tmp_path)
    ui = kernel.resolve("ui")
    _capture_text(ui, "买牛奶")

    hit = _nodes(_main(_submit(ui, "牛奶")), "result")[0]["props"]
    assert (hit["snippet"], hit["highlight"], hit["meta"]) == ("买牛奶", "牛奶", "刚刚")

    _click_button(ui, "← 返回")
    uploaded = kernel.resolve("media").save(b"video", "video/webm")
    _click_tile(ui, "视频")
    recorder = _nodes(_main(_tree_view(ui)), "video_capture")[0]
    _fire(
        ui,
        recorder["events"]["submit"],
        {"media": uploaded, "mime": "video/webm", "seconds": 5},
    )

    marker = _nodes(_main(_submit(ui, "视频")), "result")[0]["props"]["meta"]
    assert marker == "刚刚 · 视频"


def test_archived_ideas_drop_out_of_the_results(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _capture_text(ui, "买牛奶")
    _capture_text(ui, "牛奶要冷的")
    _open_rail(ui, "牛奶要冷的")
    _click_button(ui, "归档")

    assert _titles(_main(_submit(ui, "牛奶")), "result") == ["买牛奶"]
