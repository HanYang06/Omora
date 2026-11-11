from typing import Any

import pytest

from omora.sdk.realtime import emit


class FakeNet:
    def __init__(self) -> None:
        self.sent: list[tuple[str, dict[str, Any], bool]] = []

    def emit(self, topic: str, payload: dict[str, Any], *, coalesce: bool = False) -> None:
        self.sent.append((topic, payload, coalesce))


class FakeContext:
    def __init__(self, net: Any = None) -> None:
        self._net = net

    def resolve(self, name: str) -> Any:
        if self._net is None or name != "net":
            raise LookupError(name)
        return self._net


def test_emit_hands_the_event_to_net() -> None:
    net = FakeNet()

    emit(FakeContext(net), "ui.snapshot", {"version": 8})

    assert net.sent == [("ui.snapshot", {"version": 8}, False)]


def test_emit_passes_the_coalesce_flag() -> None:
    net = FakeNet()

    emit(FakeContext(net), "media.progress", {"percent": 42.5}, coalesce=True)

    assert net.sent == [("media.progress", {"percent": 42.5}, True)]


def test_emit_without_a_net_service_is_dropped() -> None:
    with pytest.raises(LookupError):
        FakeContext().resolve("net")

    emit(FakeContext(), "ui.snapshot", {"version": 8})
