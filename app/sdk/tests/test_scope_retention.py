"""节点作用域保留语义：remove/unmount 保留子树，只有 dispose 永久；move 到非 live 目标延迟挂 host。

children 永远是直接子节点；remove 只摘下自己一层；root unmount 只关 host 保留 parent 链。
"""

from __future__ import annotations

import pytest

from omora.sdk.authoring import (
    Host,
    LifecycleEvent,
    LifecycleHook,
    LifecycleHooks,
    Node,
    ParentRef,
    Request,
    Response,
)


def make_tree() -> tuple[Node, Node, Node]:
    app = Node("app")
    page = Node("page")
    leaf = Node("button", state={"pressed": False})
    app.add(page)
    page.add(leaf)
    return app, page, leaf


def host_of(node: Node) -> Host:
    host = node.host
    assert host is not None
    return host


def tracked(kind: str, events: list[LifecycleEvent]) -> Node:
    def record(event: LifecycleEvent) -> None:
        events.append(event)

    return Node(
        kind,
        hooks=LifecycleHooks(
            on_create=record,
            on_mount=record,
            on_update=record,
            on_reparent=record,
            on_unmount=record,
            on_dispose=record,
        ),
    )


def ids_of(events: list[LifecycleEvent], hook: LifecycleHook) -> list[str]:
    return [event.node.id for event in events if event.hook is hook]


def test_children_is_always_the_direct_child_list() -> None:
    _, page, leaf = make_tree()
    inner = Node("text")
    leaf.add(inner)
    assert page.children == (leaf,)
    page.remove(leaf)
    assert not page.children
    assert leaf.children == (inner,)
    assert inner.parent == ParentRef(id=leaf.id, kind=leaf.kind)


def test_remove_closes_hosts_and_unmounts_children_first() -> None:
    events: list[LifecycleEvent] = []
    app = tracked("app", events)
    page = tracked("page", events)
    leaf = tracked("button", events)
    inner = tracked("text", events)
    app.add(page)
    page.add(leaf)
    leaf.add(inner)
    inner_host = host_of(inner)
    events.clear()

    page.remove(leaf)

    assert ids_of(events, LifecycleHook.UNMOUNT) == [inner.id, leaf.id]
    assert leaf.parent is None
    assert leaf.children == (inner,)
    assert inner.parent == ParentRef(id=leaf.id, kind=leaf.kind)
    assert leaf.mounted is False
    assert inner_host.dispatch(Request("focus")) == Response.HOST_GONE
    assert leaf.request("focus") == Response.HOST_GONE


def test_root_unmount_retains_subtree_and_parent_chain() -> None:
    events: list[LifecycleEvent] = []
    app = tracked("app", events)
    page = tracked("page", events)
    leaf = tracked("button", events)
    app.add(page)
    page.add(leaf)
    page_host = host_of(page)
    leaf_host = host_of(leaf)
    events.clear()

    app.unmount()

    assert ids_of(events, LifecycleHook.UNMOUNT) == [leaf.id, page.id, app.id]
    assert app.children == (page,)
    assert page.parent == ParentRef(id=app.id, kind=app.kind)
    assert leaf.parent == ParentRef(id=page.id, kind=page.kind)
    assert page.children == (leaf,)
    assert page.mounted is False
    assert leaf.mounted is False
    assert app.disposed is False
    assert page_host.dispatch(Request("focus")) == Response.HOST_GONE
    assert leaf_host.dispatch(Request("focus")) == Response.HOST_GONE
    assert leaf.request("focus") == Response.HOST_GONE


def test_remount_after_remove_creates_hosts_parent_first() -> None:
    events: list[LifecycleEvent] = []
    app = tracked("app", events)
    page = tracked("page", events)
    leaf = tracked("button", events)
    inner = tracked("text", events)
    app.add(page)
    page.add(leaf)
    leaf.add(inner)
    page.remove(leaf)
    events.clear()

    page.add(leaf)

    assert leaf.parent == ParentRef(id=page.id, kind=page.kind)
    assert leaf.mounted
    assert inner.mounted
    assert ids_of(events, LifecycleHook.MOUNT) == [leaf.id, inner.id]


def test_dispose_is_permanent_and_retains_subtree() -> None:
    events: list[LifecycleEvent] = []
    app = tracked("app", events)
    page = tracked("page", events)
    leaf = tracked("button", events)
    app.add(page)
    page.add(leaf)
    events.clear()

    app.dispose()

    assert ids_of(events, LifecycleHook.UNMOUNT) == [leaf.id, page.id, app.id]
    assert ids_of(events, LifecycleHook.DISPOSE) == [leaf.id, page.id, app.id]
    assert app.disposed
    assert page.disposed
    assert leaf.disposed
    assert app.children == (page,)
    assert page.parent == ParentRef(id=app.id, kind=app.kind)
    assert leaf.parent == ParentRef(id=page.id, kind=page.kind)
    with pytest.raises(ValueError, match="已销毁"):
        page.add(Node("text"))


def test_move_into_a_detached_parent_defers_the_host() -> None:
    app, page, leaf = make_tree()
    inner = Node("text")
    leaf.add(inner)
    target = Node("page")
    assert target.mounted is False

    page.move(leaf, target)

    assert leaf.parent == ParentRef(id=target.id, kind=target.kind)
    assert target.children == (leaf,)
    assert leaf.mounted is False
    assert leaf.host is None
    assert inner.mounted is False
    assert inner.host is None

    app.add(target)

    assert target.mounted
    assert leaf.mounted
    assert inner.mounted
    assert leaf.host is not None
    assert inner.host is not None
    assert leaf.parent == ParentRef(id=target.id, kind=target.kind)
