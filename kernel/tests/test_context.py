"""作用域树的行为：注入解析、激活顺序、释放顺序与绑定清理。"""

from __future__ import annotations

import asyncio

from omora_kernel.context import Context, Hook, UnavailableError


def make_hook(label: str, calls: list[str]) -> Hook:
    async def hook() -> None:
        calls.append(label)

    return hook


def test_child_scope_injects_binding_from_parent() -> None:
    root = Context("root")
    child = root.child("child")
    binding = object()
    root.provide("clock", binding)

    assert child.inject("clock") is binding


def test_nearest_scope_wins_when_token_is_shadowed() -> None:
    root = Context("root")
    child = root.child("child")
    root.provide("clock", "root-clock")
    child.provide("clock", "child-clock")

    assert child.inject("clock") == "child-clock"
    assert root.inject("clock") == "root-clock"


def test_inject_raises_unavailable_for_unknown_token() -> None:
    scope = Context("root")

    try:
        scope.inject("missing")
    except UnavailableError as error:
        assert error.code == "E_UNAVAILABLE"
        assert error.token == "missing"
        return
    raise AssertionError("未提供的 token 应抛出 UnavailableError")


def test_try_inject_returns_binding_or_none() -> None:
    scope = Context("root")
    binding = object()
    scope.provide("clock", binding)

    assert scope.try_inject("clock") is binding
    assert scope.try_inject("missing") is None


def test_duplicate_provide_in_same_scope_is_rejected() -> None:
    scope = Context("root")
    scope.provide("clock", object())

    try:
        scope.provide("clock", object())
    except ValueError:
        return
    raise AssertionError("同一作用域重复提供 token 应被拒绝")


def test_activation_hooks_run_in_registration_order() -> None:
    scope = Context("root")
    calls: list[str] = []
    scope.on_activate(make_hook("first", calls))
    scope.on_activate(make_hook("second", calls))

    asyncio.run(scope.activate())

    assert calls == ["first", "second"]


def test_dispose_hooks_run_in_reverse_registration_order() -> None:
    scope = Context("root")
    calls: list[str] = []
    scope.on_dispose(make_hook("first", calls))
    scope.on_dispose(make_hook("second", calls))

    asyncio.run(scope.dispose())

    assert calls == ["second", "first"]


def test_dispose_releases_child_scopes_before_own_hooks() -> None:
    root = Context("root")
    first = root.child("first")
    second = root.child("second")
    calls: list[str] = []
    first.on_dispose(make_hook("first", calls))
    second.on_dispose(make_hook("second", calls))
    root.on_dispose(make_hook("root", calls))

    asyncio.run(root.dispose())

    assert calls == ["second", "first", "root"]


def test_dispose_clears_bindings() -> None:
    scope = Context("root")
    scope.provide("clock", object())

    asyncio.run(scope.dispose())

    try:
        scope.inject("clock")
    except UnavailableError as error:
        assert error.token == "clock"
        return
    raise AssertionError("释放后绑定应被清空")


def test_dispose_runs_hooks_only_once() -> None:
    scope = Context("root")
    calls: list[str] = []
    scope.on_dispose(make_hook("hook", calls))

    asyncio.run(scope.dispose())
    asyncio.run(scope.dispose())

    assert calls == ["hook"]


def test_dispose_continues_after_failing_hook() -> None:
    scope = Context("root")
    calls: list[str] = []

    async def failing_hook() -> None:
        calls.append("failing")
        raise RuntimeError("boom")

    scope.on_dispose(make_hook("first", calls))
    scope.on_dispose(failing_hook)
    scope.on_dispose(make_hook("last", calls))

    try:
        asyncio.run(scope.dispose())
    except ExceptionGroup as group:
        assert len(group.exceptions) == 1
        assert str(group.exceptions[0]) == "boom"
    else:
        raise AssertionError("清理钩子失败应向上抛出")
    assert calls == ["last", "failing", "first"]


def test_provide_after_dispose_is_rejected() -> None:
    scope = Context("root")
    asyncio.run(scope.dispose())

    try:
        scope.provide("clock", object())
    except RuntimeError:
        return
    raise AssertionError("释放后提供绑定应被拒绝")


def test_child_scope_points_back_to_parent() -> None:
    root = Context("root")
    child = root.child("child")

    assert child.name == "child"
    assert root.name == "root"
    assert child.parent is root
    assert root.parent is None
