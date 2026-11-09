from collections.abc import Mapping
from typing import Any

import pytest

from boot import Config, build
from omora.core.context import Context


class _Fake:
    def __init__(self, name: str, **config: Any) -> None:
        self.name = name
        self.config = config

    def apply(self, ctx: Context) -> None:
        ctx.provide(self.name, self)


class _Broken:
    name = "broken"

    def __init__(self, **config: Any) -> None:
        self.config = config

    def apply(self, ctx: Context) -> None:
        raise RuntimeError("boom")


def _loader(name: str, settings: Mapping[str, Any]) -> Any:
    if name == "broken":
        return _Broken(**settings)
    return _Fake(name, **settings)


def test_plugins_are_installed_in_manifest_order() -> None:
    kernel = build(Config({}), ("a", "b"), loader=_loader)

    assert kernel.names() == ("a", "b")


def test_a_disabled_plugin_is_not_installed() -> None:
    config = Config({"a": {"enabled": False}})

    kernel = build(config, ("a", "b"), loader=_loader)

    assert kernel.names() == ("b",)


def test_plugin_receives_its_own_config_section() -> None:
    config = Config({"a": {"size": 3}, "b": {"size": 9}})

    kernel = build(config, ("a", "b"), loader=_loader)

    assert kernel.resolve("a").config == {"size": 3}
    assert kernel.resolve("b").config == {"size": 9}


def test_a_failing_plugin_names_itself() -> None:
    with pytest.raises(RuntimeError, match="boom") as info:
        build(Config({}), ("broken",), loader=_loader)

    notes = "\n".join(info.value.__notes__ or [])
    assert '插件 "broken" 装载失败' in notes
