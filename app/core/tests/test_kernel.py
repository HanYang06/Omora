from collections.abc import Callable

import pytest

from core.context import Context
from core.kernel import Kernel


class _Plugin:
    def __init__(self, name: str, apply: Callable[[Context], None]) -> None:
        self.name = name
        self.apply = apply


def test_plugin_provides_service_that_other_plugin_resolves() -> None:
    kernel = Kernel()
    kernel.install(_Plugin("store", lambda ctx: ctx.provide("store", ["a", "b"])))

    seen: list[list[str]] = []

    def reader(ctx: Context) -> None:
        rows: list[str] = ctx.resolve("store")
        seen.append(rows)

    kernel.install(_Plugin("list", reader))

    assert seen == [["a", "b"]]
    assert kernel.running("store")
    store: list[str] = kernel.resolve("store")
    assert store == ["a", "b"]


def test_uninstall_removes_service() -> None:
    kernel = Kernel()
    kernel.install(_Plugin("store", lambda ctx: ctx.provide("store", {})))

    kernel.uninstall("store")

    assert not kernel.running("store")
    with pytest.raises(LookupError, match="服务未提供: store"):
        kernel.resolve("store")


def test_effects_run_in_reverse_order_on_uninstall() -> None:
    order: list[str] = []
    kernel = Kernel()

    def plugin(ctx: Context) -> None:
        ctx.effect(lambda: order.append("first"))
        ctx.effect(lambda: order.append("second"))

    kernel.install(_Plugin("p", plugin))

    kernel.uninstall("p")

    assert order == ["second", "first"]


def test_failed_apply_rolls_back_registrations() -> None:
    kernel = Kernel()
    undone: list[str] = []

    def apply(ctx: Context) -> None:
        ctx.provide("half", {})
        ctx.effect(lambda: undone.append("undo"))
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError, match="boom"):
        kernel.install(_Plugin("broken", apply))

    assert undone == ["undo"]
    assert not kernel.running("broken")
    with pytest.raises(LookupError, match="服务未提供: half"):
        kernel.resolve("half")


def test_same_plugin_cannot_be_installed_twice() -> None:
    kernel = Kernel()
    kernel.install(_Plugin("p", lambda ctx: None))

    with pytest.raises(ValueError, match="插件已安装: p"):
        kernel.install(_Plugin("p", lambda ctx: None))


def test_unknown_plugin_is_not_running() -> None:
    kernel = Kernel()

    assert not kernel.running("nope")
    assert kernel.names() == ()


def test_install_returns_a_handle_that_uninstalls_the_plugin() -> None:
    kernel = Kernel()
    handle = kernel.install(_Plugin("store", lambda ctx: ctx.provide("store", {})))

    assert handle.name == "store"

    handle.dispose()

    assert not kernel.running("store")
    with pytest.raises(LookupError, match="服务未提供: store"):
        kernel.resolve("store")


def test_failed_install_notes_the_plugin_name() -> None:
    def boom(ctx: Context) -> None:
        raise RuntimeError("boom")

    kernel = Kernel()

    with pytest.raises(RuntimeError, match="boom") as info:
        kernel.install(_Plugin("broken", boom))

    notes = "\n".join(info.value.__notes__ or [])
    assert '插件 "broken" 装载失败' in notes


def test_one_failing_effect_does_not_stop_the_rest() -> None:
    order: list[str] = []

    def apply(ctx: Context) -> None:
        ctx.effect(lambda: order.append("first"))

        def failing() -> None:
            raise RuntimeError("undo boom")

        ctx.effect(failing)
        ctx.effect(lambda: order.append("third"))

    kernel = Kernel()
    kernel.install(_Plugin("p", apply))

    with pytest.raises(RuntimeError, match="undo boom"):
        kernel.uninstall("p")

    assert order == ["third", "first"]


def test_glue_plugin_only_wires_two_capabilities() -> None:
    kernel = Kernel()
    calls: list[str] = []
    kernel.install(_Plugin("list", lambda ctx: ctx.provide("list", ["a", "b"])))
    kernel.install(
        _Plugin(
            "editor",
            lambda ctx: ctx.provide("editor", lambda row: calls.append(f"open:{row}")),
        )
    )

    def glue(ctx: Context) -> None:
        rows: list[str] = ctx.resolve("list")
        open_row: Callable[[str], None] = ctx.resolve("editor")
        open_row(rows[0])

    kernel.install(_Plugin("glue", glue))

    assert calls == ["open:a"]
