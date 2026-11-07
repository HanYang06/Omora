"""命令与查询注册表的行为：命名空间、作用域回收、失败语义与异常传播。"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping

from omora_kernel.context import Context, UnavailableError
from omora_kernel.contract.c1 import CommandHandler, QueryHandler
from omora_kernel.registry import CommandRegistry, QueryRegistry


async def returning_none(args: Mapping[str, object]) -> object:
    return None


def test_command_dispatch_reaches_handler_with_args() -> None:
    registry = CommandRegistry()
    scope = Context("root")
    received: list[Mapping[str, object]] = []

    async def handler(args: Mapping[str, object]) -> object:
        received.append(args)
        return "done"

    registry.register(scope, "sample.run", handler)

    assert asyncio.run(registry.invoke("sample.run", {"value": 1})) == "done"
    assert received == [{"value": 1}]


def test_query_dispatch_reaches_handler_with_args() -> None:
    registry = QueryRegistry()
    scope = Context("root")

    async def handler(args: Mapping[str, object]) -> object:
        return args.get("value")

    registry.register(scope, "sample.read", handler)

    assert asyncio.run(registry.invoke("sample.read", {"value": 7})) == 7


def test_command_and_query_namespaces_are_separate() -> None:
    commands = CommandRegistry()
    queries = QueryRegistry()
    scope = Context("root")

    async def command_handler(args: Mapping[str, object]) -> object:
        return "command"

    async def query_handler(args: Mapping[str, object]) -> object:
        return "query"

    commands.register(scope, "shared.name", command_handler)
    queries.register(scope, "shared.name", query_handler)

    assert asyncio.run(commands.invoke("shared.name", {})) == "command"
    assert asyncio.run(queries.invoke("shared.name", {})) == "query"


def test_unknown_command_raises_unavailable() -> None:
    registry = CommandRegistry()

    try:
        asyncio.run(registry.invoke("missing.command", {}))
    except UnavailableError as error:
        assert error.code == "E_UNAVAILABLE"
        assert error.token == "missing.command"
        return
    raise AssertionError("未注册的命令应给出 E_UNAVAILABLE")


def test_unknown_query_raises_unavailable() -> None:
    registry = QueryRegistry()

    try:
        asyncio.run(registry.invoke("missing.query", {}))
    except UnavailableError as error:
        assert error.code == "E_UNAVAILABLE"
        assert error.token == "missing.query"
        return
    raise AssertionError("未注册的查询应给出 E_UNAVAILABLE")


def test_disposing_scope_removes_commands_without_residue() -> None:
    registry = CommandRegistry()
    root = Context("root")
    scope = root.child("scope")
    registry.register(scope, "first.run", returning_none)
    registry.register(scope, "second.run", returning_none)

    assert registry.names() == ("first.run", "second.run")

    asyncio.run(scope.dispose())

    assert registry.names() == ()
    try:
        asyncio.run(registry.invoke("first.run", {}))
    except UnavailableError as error:
        assert error.token == "first.run"
        return
    raise AssertionError("作用域释放后命令不应还能分发")


def test_disposing_scope_removes_queries_without_residue() -> None:
    registry = QueryRegistry()
    root = Context("root")
    scope = root.child("scope")
    registry.register(scope, "sample.read", returning_none)

    asyncio.run(scope.dispose())

    assert registry.names() == ()
    try:
        asyncio.run(registry.invoke("sample.read", {}))
    except UnavailableError as error:
        assert error.token == "sample.read"
        return
    raise AssertionError("作用域释放后查询不应还能分发")


def test_disposing_one_scope_keeps_other_registrations() -> None:
    registry = CommandRegistry()
    root = Context("root")
    child = root.child("child")

    async def root_handler(args: Mapping[str, object]) -> object:
        return "root"

    async def child_handler(args: Mapping[str, object]) -> object:
        return "child"

    registry.register(root, "root.run", root_handler)
    registry.register(child, "child.run", child_handler)

    asyncio.run(child.dispose())

    assert registry.names() == ("root.run",)
    assert asyncio.run(registry.invoke("root.run", {})) == "root"


def test_duplicate_command_registration_is_rejected() -> None:
    registry = CommandRegistry()
    scope = Context("root")
    registry.register(scope, "sample.run", returning_none)

    try:
        registry.register(scope, "sample.run", returning_none)
    except ValueError:
        return
    raise AssertionError("同名命令重复注册应被拒绝")


def test_duplicate_query_registration_is_rejected() -> None:
    registry = QueryRegistry()
    scope = Context("root")
    registry.register(scope, "sample.read", returning_none)

    try:
        registry.register(scope, "sample.read", returning_none)
    except ValueError:
        return
    raise AssertionError("同名查询重复注册应被拒绝")


def test_handler_error_propagates_unchanged() -> None:
    registry = CommandRegistry()
    scope = Context("root")
    boom = RuntimeError("boom")

    async def handler(args: Mapping[str, object]) -> object:
        raise boom

    registry.register(scope, "failing.run", handler)

    try:
        asyncio.run(registry.invoke("failing.run", {}))
    except RuntimeError as error:
        assert error is boom
        return
    raise AssertionError("handler 异常应原样上抛")


def test_registering_on_disposed_scope_leaves_no_residue() -> None:
    registry = CommandRegistry()
    scope = Context("root")
    asyncio.run(scope.dispose())

    try:
        registry.register(scope, "late.run", returning_none)
    except RuntimeError:
        pass
    else:
        raise AssertionError("向已释放作用域注册命令应被拒绝")

    assert registry.names() == ()


def test_command_registry_satisfies_c1_command_handler() -> None:
    registry = CommandRegistry()
    port: CommandHandler = registry
    scope = Context("root")

    async def handler(args: Mapping[str, object]) -> object:
        return args.get("value")

    registry.register(scope, "sample.run", handler)

    assert asyncio.run(port.invoke("sample.run", {"value": 5})) == 5


def test_query_registry_satisfies_c1_query_handler() -> None:
    registry = QueryRegistry()
    port: QueryHandler = registry
    scope = Context("root")

    async def handler(args: Mapping[str, object]) -> object:
        return {"items": [args.get("value")]}

    registry.register(scope, "sample.read", handler)

    assert asyncio.run(port.invoke("sample.read", {"value": 5})) == {"items": [5]}
