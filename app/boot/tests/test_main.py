import asyncio
from typing import Any

import main as entry


def test_main_boots_the_kernel_and_stops_net(monkeypatch: Any) -> None:
    class Config:
        def unclaimed(self) -> list[str]:
            return ["stray"]

    class Log:
        def child(self, name: str) -> Log:
            return self

        def warning(self, *args: Any, **kwargs: Any) -> None:
            pass

        def info(self, *args: Any, **kwargs: Any) -> None:
            pass

    class Net:
        host = "127.0.0.1"
        media_url = None

        def __init__(self) -> None:
            self.stopped = False

        async def serve(self) -> int:
            return 8765

        async def stop(self) -> None:
            self.stopped = True

    net = Net()

    class Kernel:
        def resolve(self, name: str) -> Net:
            return net

    class Event:
        async def wait(self) -> None:
            return

    def fake_config(*_args: Any, **_kwargs: Any) -> Config:
        return Config()

    def fake_log(*_args: Any, **_kwargs: Any) -> Log:
        return Log()

    def fake_build(*_args: Any, **_kwargs: Any) -> Kernel:
        return Kernel()

    monkeypatch.setattr(entry, "load_config", fake_config)
    monkeypatch.setattr(entry, "build_log", fake_log)
    monkeypatch.setattr(entry, "build", fake_build)
    monkeypatch.setattr(asyncio, "Event", Event)

    assert entry.main() == 0
    assert net.stopped
