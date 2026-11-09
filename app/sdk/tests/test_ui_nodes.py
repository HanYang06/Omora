from typing import Any

from omora.sdk.ui import Handler, Result, Search, Suggestion, serialize


def _noop(payload: dict[str, Any]) -> None:
    pass


def _ids(*names: str) -> Any:
    remaining = iter(names)

    def register(handler: Handler) -> str:
        return next(remaining)

    return register


def test_serializing_a_search_keeps_its_suggestions_in_children() -> None:
    tree = Search(
        Suggestion(value="买牛奶", title="买牛奶", meta="刚刚", highlight="牛奶", on_pick=_noop),
        placeholder="搜索灵感…",
        value="牛奶",
        on_query=_noop,
        on_submit=_noop,
    )

    node = serialize(tree, _ids("h0", "h1", "h2"))

    assert node == {
        "type": "search",
        "props": {
            "placeholder": "搜索灵感…",
            "value": "牛奶",
            "on_query": "h0",
            "on_submit": "h1",
        },
        "children": [
            {
                "type": "suggestion",
                "props": {
                    "value": "买牛奶",
                    "title": "买牛奶",
                    "meta": "刚刚",
                    "highlight": "牛奶",
                    "on_pick": "h2",
                },
                "children": [],
            }
        ],
    }


def test_serializing_a_result_drops_the_fields_that_are_not_set() -> None:
    node = serialize(
        Result(title="买牛奶", snippet="…买牛奶…", meta="刚刚", on_click=_noop),
        _ids("h0"),
    )

    assert node == {
        "type": "result",
        "props": {
            "title": "买牛奶",
            "snippet": "…买牛奶…",
            "meta": "刚刚",
            "on_click": "h0",
        },
        "children": [],
    }
