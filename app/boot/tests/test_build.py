from collections.abc import Callable
from typing import Any

import pytest

from boot import Config, build
from core.context import Context


class _Fake:
    def __init__(self, name: str, **config: Any) -> None:
        self.name = name
        self.config = config

    def apply(self, ctx: Context) -> None:
        ctx.provide(self.name, self)


def _factory(name: str) -> Callable[..., _Fake]:
    def make(**config: Any) -> _Fake:
        return _Fake(name, **config)

    return make


class _Broken:
    name = "broken"

    def __init__(self, **config: Any) -> None:
        self.config = config

    def apply(self, ctx: Context) -> None:
        raise RuntimeError("boom")


def test_plugins_are_installed_in_manifest_order() -> None:
    kernel = build(Config({}), (("a", _factory("a")), ("b", _factory("b"))))

    assert kernel.names() == ("a", "b")


def test_a_disabled_plugin_is_not_installed() -> None:
    config = Config({"a": {"enabled": False}})

    kernel = build(config, (("a", _factory("a")), ("b", _factory("b"))))

    assert kernel.names() == ("b",)


def test_plugin_receives_its_own_config_section() -> None:
    config = Config({"a": {"size": 3}, "b": {"size": 9}})

    kernel = build(config, (("a", _factory("a")), ("b", _factory("b"))))

    assert kernel.resolve("a").config == {"size": 3}
    assert kernel.resolve("b").config == {"size": 9}


def test_a_failing_plugin_names_itself() -> None:
    with pytest.raises(RuntimeError, match="boom") as info:
        build(Config({}), (("broken", _Broken),))

    notes = "\n".join(info.value.__notes__ or [])
    assert '插件 "broken" 装载失败' in notes
