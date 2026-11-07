"""服务注册表的行为：解析顺序、循环依赖快速失败、激活与逆序释放。"""

from __future__ import annotations

import asyncio
from typing import cast

from omora_kernel.context import Context, UnavailableError
from omora_kernel.services import (
    CircularDependencyError,
    ServiceFactory,
    ServiceRegistry,
    ServiceSpec,
)


class Probe:
    """记录生命周期调用、并可持有上游依赖的服务替身。"""

    def __init__(self, name: str, log: list[str], upstream: object | None = None) -> None:
        self.name = name
        self.upstream = upstream
        self._log = log

    async def activate(self) -> None:
        self._log.append(f"activate:{self.name}")

    async def dispose(self) -> None:
        self._log.append(f"dispose:{self.name}")


class FailingProbe(Probe):
    """激活即失败的服务替身。"""

    async def activate(self) -> None:
        raise RuntimeError("boom")


def probe_factory(name: str, log: list[str]) -> ServiceFactory:
    def factory(*_dependencies: object) -> object:
        return Probe(name, log)

    return factory


def dependent_factory(name: str, log: list[str]) -> ServiceFactory:
    def factory(upstream: object) -> object:
        return Probe(name, log, upstream)

    return factory


def failing_factory(name: str, log: list[str]) -> ServiceFactory:
    def factory(*_dependencies: object) -> object:
        return FailingProbe(name, log)

    return factory


def test_resolution_order_keeps_registration_order_without_dependencies() -> None:
    registry = ServiceRegistry()
    for name in ("one", "two", "three"):
        registry.register(ServiceSpec(name, probe_factory(name, [])))

    assert registry.resolution_order() == ("one", "two", "three")


def test_resolution_order_places_dependencies_before_dependents() -> None:
    registry = ServiceRegistry()
    registry.register(ServiceSpec("api", probe_factory("api", []), dependencies=("db",)))
    registry.register(ServiceSpec("db", probe_factory("db", [])))

    assert registry.resolution_order() == ("db", "api")


def test_services_activate_in_dependency_order() -> None:
    log: list[str] = []
    registry = ServiceRegistry()
    registry.register(ServiceSpec("leaf", probe_factory("leaf", log)))
    registry.register(ServiceSpec("root", dependent_factory("root", log), dependencies=("leaf",)))
    scope = Context("scope")

    asyncio.run(registry.activate(scope))

    assert log == ["activate:leaf", "activate:root"]


def test_services_dispose_in_reverse_activation_order() -> None:
    log: list[str] = []
    registry = ServiceRegistry()
    registry.register(ServiceSpec("leaf", probe_factory("leaf", log)))
    registry.register(ServiceSpec("root", dependent_factory("root", log), dependencies=("leaf",)))
    scope = Context("scope")
    asyncio.run(registry.activate(scope))

    asyncio.run(scope.dispose())

    assert log == ["activate:leaf", "activate:root", "dispose:root", "dispose:leaf"]


def test_circular_dependency_fails_before_any_service_is_created() -> None:
    log: list[str] = []
    registry = ServiceRegistry()
    registry.register(ServiceSpec("a", probe_factory("a", log), dependencies=("b",)))
    registry.register(ServiceSpec("b", probe_factory("b", log), dependencies=("a",)))
    scope = Context("scope")

    try:
        asyncio.run(registry.activate(scope))
    except CircularDependencyError as error:
        assert error.cycle == ("a", "b", "a")
    else:
        raise AssertionError("循环依赖应在解析阶段失败")
    assert log == []


def test_missing_dependency_raises_unavailable_before_any_service_is_created() -> None:
    log: list[str] = []
    registry = ServiceRegistry()
    registry.register(ServiceSpec("api", probe_factory("api", log), dependencies=("db",)))
    scope = Context("scope")

    try:
        asyncio.run(registry.activate(scope))
    except UnavailableError as error:
        assert error.token == "db"
        assert error.code == "E_UNAVAILABLE"
    else:
        raise AssertionError("未注册的依赖应给出 E_UNAVAILABLE")
    assert log == []


def test_factory_receives_declared_dependency() -> None:
    log: list[str] = []
    leaf = Probe("leaf", log)
    registry = ServiceRegistry()
    registry.register(ServiceSpec("leaf", lambda: leaf))
    registry.register(ServiceSpec("root", dependent_factory("root", log), dependencies=("leaf",)))
    scope = Context("scope")

    asyncio.run(registry.activate(scope))

    dependent = cast("Probe", scope.inject("root"))
    assert dependent.upstream is leaf


def test_activated_services_are_injectable_from_scope() -> None:
    log: list[str] = []
    leaf = Probe("leaf", log)
    registry = ServiceRegistry()
    registry.register(ServiceSpec("leaf", lambda: leaf))
    scope = Context("scope")

    asyncio.run(registry.activate(scope))

    assert scope.inject("leaf") is leaf


def test_duplicate_service_name_is_rejected() -> None:
    registry = ServiceRegistry()
    registry.register(ServiceSpec("leaf", probe_factory("leaf", [])))

    try:
        registry.register(ServiceSpec("leaf", probe_factory("leaf", [])))
    except ValueError:
        return
    raise AssertionError("同名服务重复注册应被拒绝")


def test_failed_activation_only_disposes_services_that_activated() -> None:
    log: list[str] = []
    registry = ServiceRegistry()
    registry.register(ServiceSpec("leaf", probe_factory("leaf", log)))
    registry.register(ServiceSpec("broken", failing_factory("broken", log)))
    registry.register(ServiceSpec("tail", dependent_factory("tail", log), dependencies=("broken",)))
    scope = Context("scope")

    try:
        asyncio.run(registry.activate(scope))
    except RuntimeError as error:
        assert str(error) == "boom"
    else:
        raise AssertionError("激活失败应向上抛出")

    asyncio.run(scope.dispose())

    assert log == ["activate:leaf", "dispose:leaf"]
