"""构建期 V1 输入：页面顺序、默认页、产物文本。"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import static_tree

from omora.core.kernel import Kernel
from omora.sdk.tree import parse_document, parse_partial
from omora.sdk.ui import Column, Page, Text
from omora.ui import UiPlugin


def _body(text: str) -> Callable[[], Page]:
    def build() -> Page:
        return Page(Column(Text(text)))

    return build


class _Pages:
    def __init__(self, names: tuple[str, ...]) -> None:
        self.name = "pages"
        self._names = names

    def apply(self, ctx: Any) -> None:
        ui = ctx.resolve("ui")
        for name in self._names:
            ui.page(ctx, name, name, _body(name))


def _kernel(*names: str) -> Kernel:
    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_Pages(names))
    return kernel


def test_collect_keeps_page_order_and_default() -> None:
    payload = static_tree.collect(_kernel("ideas", "projects"))

    assert payload["format"] == "omora.tree.build/1"
    assert payload["default"] == "ideas"
    assert [page["name"] for page in payload["pages"]] == ["ideas", "projects"]


def test_collect_outputs_valid_documents_and_partials() -> None:
    payload = static_tree.collect(_kernel("ideas", "projects"))

    for page in payload["pages"]:
        parse_document(page["base"])
        assert len(page["partials"]) == 3  # 两条导航 + 页面内容
        for partial in page["partials"]:
            parse_partial(partial)


def test_render_file_is_stable_and_ends_with_newline() -> None:
    payload = static_tree.collect(_kernel("ideas"))

    first = static_tree.render_file(payload)
    second = static_tree.render_file(static_tree.collect(_kernel("ideas")))

    assert first == second
    assert first.endswith("\n")


def test_committed_input_matches_the_generator() -> None:
    with static_tree.system_kernel() as kernel:
        payload = static_tree.collect(kernel)

    assert static_tree.OUT.read_text(encoding="utf-8") == static_tree.render_file(payload)
