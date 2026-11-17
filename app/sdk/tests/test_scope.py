"""authoring 节点作用域 / host 核心的行为测试。

契约形状从 schema/sdk/scope.json 读：先钉住错误码、标准请求、响应、能力端口与
生命周期钩子与实现一致，再用行为测试证明父权、级联、move、clone、请求与能力。
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import FrozenInstanceError
from pathlib import Path
from typing import Any

import pytest

from omora.sdk.authoring import (
    CAPABILITY_TYPES,
    ERROR_CODES,
    ID_PATTERN,
    LIFECYCLE_HOOKS,
    STANDARD_REQUESTS,
    Host,
    LifecycleEvent,
    LifecycleHook,
    LifecycleHooks,
    Node,
    ParentRef,
    Request,
    Response,
    ScopeError,
)

ROOT = Path(__file__).resolve().parents[3]
CONTRACT: dict[str, Any] = json.loads(
    (ROOT / "schema" / "sdk" / "scope.json").read_text(encoding="utf-8")
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


def error_of(call: Callable[[], object]) -> ScopeError:
    with pytest.raises(ScopeError) as exc:
        call()
    return exc.value


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


def test_contract_constants_match() -> None:
    assert frozenset(CONTRACT["errors"]) == ERROR_CODES
    assert frozenset(CONTRACT["lifecycle"]["hooks"]) == LIFECYCLE_HOOKS
    assert {response.value for response in Response} == set(CONTRACT["request"]["responses"])
    assert {name: dict(fields) for name, fields in STANDARD_REQUESTS.items()} == {
        entry["name"]: entry["fields"] for entry in CONTRACT["request"]["standard"]
    }
    assert {name: list(methods) for name, methods in CAPABILITY_TYPES.items()} == {
        entry["name"]: entry["methods"] for entry in CONTRACT["capability"]["types"]
    }


def test_invalid_inputs_are_rejected() -> None:
    with pytest.raises(ValueError, match="不是契约里的作用域错误码"):
        ScopeError("E-SCOPE-NOT-IN-CONTRACT", "$", "x")
    with pytest.raises(ValueError, match="kind"):
        Node("")
    with pytest.raises(ValueError, match="id 必须"):
        Node("button", id="not-a-stable-id")
    _, page, leaf = make_tree()
    page.handle(leaf, "navigate", lambda request: Response.HANDLED)
    with pytest.raises(ValueError, match="字段不符"):
        leaf.request("navigate")
    with pytest.raises(ValueError, match="route"):
        leaf.request("navigate", route=1)
    with pytest.raises(ValueError, match="未知能力类型"):
        page.grant(leaf, "teleport")
    with pytest.raises(ValueError, match="未知能力类型"):
        host_of(leaf).capability("teleport")


def test_parent_ref_is_read_only_and_exposes_no_handle() -> None:
    _, page, leaf = make_tree()
    ref = leaf.parent
    assert ref == ParentRef(id=page.id, kind=page.kind)
    with pytest.raises(FrozenInstanceError):
        setattr(ref, "id", "0" * 16)  # noqa: B010 —— 专测 frozen dataclass 的只读行为
    assert not any(hasattr(ref, name) for name in ("add", "remove", "move", "patch"))


def test_child_cannot_mutate_parent_sibling_or_parent_link() -> None:
    app, page, leaf = make_tree()
    sibling = Node("button")
    page.add(sibling)
    with pytest.raises(ScopeError) as exc:
        leaf.parent = ParentRef(id=page.id, kind=page.kind)
    assert exc.value.code == "E-SCOPE-PARENT"
    for call in (
        lambda: leaf.remove(page),
        lambda: leaf.remove(sibling),
        lambda: leaf.move(page, app),
    ):
        assert error_of(call).code == "E-SCOPE-PARENT"
    assert page.children == (leaf, sibling)
    assert page.parent == ParentRef(id=app.id, kind=app.kind)


def test_only_parent_can_remove_child_or_unmount() -> None:
    app, page, leaf = make_tree()
    assert error_of(lambda: app.remove(leaf)).code == "E-SCOPE-NOT-CHILD"
    assert error_of(leaf.unmount).code == "E-SCOPE-PARENT"
    page.remove(leaf)
    assert leaf.parent is None
    assert leaf.mounted is False


def test_patch_only_touches_the_node_and_emits_update() -> None:
    events: list[LifecycleEvent] = []
    _, page, leaf = make_tree()
    tracked_leaf = tracked("button", events)
    page.add(tracked_leaf)
    events.clear()
    page_props = dict(page.props)

    tracked_leaf.patch(props={"label": "x"}, state={"pressed": True})

    assert dict(page.props) == page_props
    assert dict(tracked_leaf.props) == {"label": "x"}
    assert tracked_leaf.state["pressed"] is True
    assert ids_of(events, LifecycleHook.UPDATE) == [tracked_leaf.id]
    assert dict(leaf.state) == {"pressed": False}


def test_mount_hooks_run_parent_before_children() -> None:
    events: list[LifecycleEvent] = []
    app = tracked("app", events)
    page = tracked("page", events)
    leaf = tracked("button", events)
    page.add(leaf)
    app.add(page)
    assert ids_of(events, LifecycleHook.CREATE) == [app.id, page.id, leaf.id]
    events.clear()

    clone = page.clone()
    events.clear()
    app.add(clone)

    assert ids_of(events, LifecycleHook.MOUNT) == [clone.id, clone.children[0].id]


def test_self_remove_is_a_request_the_parent_handles() -> None:
    _, page, leaf = make_tree()

    def handler(request: Request) -> Response:
        page.remove(leaf)
        return Response.HANDLED

    page.handle(leaf, "remove_self", handler)
    assert leaf.request("remove_self") == Response.HOST_GONE
    assert page.children == ()
    assert leaf.mounted is False


def test_move_preserves_id_state_rebinds_host_and_reparents() -> None:
    events: list[LifecycleEvent] = []
    app = tracked("app", events)
    page = tracked("page", events)
    leaf = tracked("button", events)
    target = tracked("page", events)
    app.add(page)
    page.add(leaf)
    inner = Node("text")
    leaf.add(inner)
    inner_host = host_of(inner)
    app.add(target)
    leaf.patch(props={"label": "x"}, state={"pressed": True})
    leaf_id = leaf.id
    old_host = host_of(leaf)
    events.clear()

    page.move(leaf, target)

    assert leaf.id == leaf_id
    assert dict(leaf.props) == {"label": "x"}
    assert leaf.state["pressed"] is True
    assert leaf.parent == ParentRef(id=target.id, kind=target.kind)
    assert target.children == (leaf,)
    assert leaf.mounted
    assert leaf.host is not old_host
    assert inner.host is inner_host
    assert inner.parent == ParentRef(id=leaf.id, kind=leaf.kind)
    assert old_host.dispatch(Request("focus")) == Response.HOST_MOVED
    assert ids_of(events, LifecycleHook.REPARENT) == [leaf.id]

    target.handle(leaf, "focus", lambda request: Response.HANDLED)
    assert leaf.request("focus") == Response.HANDLED


def test_move_remount_closes_old_host_as_unmounted() -> None:
    app, page, leaf = make_tree()
    target = Node("page")
    app.add(target)
    old_host = host_of(leaf)

    page.move(leaf, target, remount=True)

    assert leaf.parent == ParentRef(id=target.id, kind=target.kind)
    assert leaf.mounted
    assert leaf.host is not old_host
    assert old_host.dispatch(Request("focus")) == Response.HOST_GONE


def test_move_rejects_node_or_descendants_as_target() -> None:
    _, page, leaf = make_tree()
    inner = Node("text")
    leaf.add(inner)
    assert error_of(lambda: page.move(leaf, leaf)).code == "E-SCOPE-MOVE-SELF"
    assert error_of(lambda: page.move(leaf, inner)).code == "E-SCOPE-MOVE-SELF"


def test_duplicate_mount_and_cycles_are_rejected() -> None:
    app, page, leaf = make_tree()
    assert error_of(lambda: app.add(leaf)).code == "E-SCOPE-DUP-MOUNT"
    assert error_of(lambda: leaf.add(app)).code == "E-SCOPE-CYCLE"
    assert error_of(lambda: page.add(page)).code == "E-SCOPE-CYCLE"


def test_clone_gets_new_identity_and_is_detached() -> None:
    _, page, leaf = make_tree()
    page.patch(props={"label": "page"}, state={"open": True})
    clone = page.clone()

    assert clone is not page
    assert clone.id != page.id
    assert ID_PATTERN.fullmatch(clone.id) is not None
    assert clone.parent is None
    assert clone.host is None
    assert clone.mounted is False
    assert clone.kind == page.kind
    assert clone.props == page.props
    assert clone.state == page.state
    cloned_leaf = clone.children[0]
    assert cloned_leaf.id != leaf.id
    assert cloned_leaf.parent == ParentRef(id=clone.id, kind=clone.kind)

    page.add(clone)
    assert clone.parent == ParentRef(id=page.id, kind=page.kind)
    assert clone.mounted


def test_forwarded_explicitly_through_each_host() -> None:
    app = Node("app")
    page = Node("page")
    panel = Node("panel")
    leaf = Node("button")
    app.add(page)
    page.add(panel)
    panel.add(leaf)
    seen: list[Request] = []

    def handler(request: Request) -> Response:
        seen.append(request)
        return Response.HANDLED

    app.handle(page, "navigate", handler)
    assert (
        error_of(lambda: leaf.request("navigate", route="/x")).code == "E-SCOPE-REQUEST-UNHANDLED"
    )
    page.forward(panel, "navigate")
    panel.forward(leaf, "navigate")
    assert leaf.request("navigate", route="/x") == Response.HANDLED
    assert dict(seen[0].fields) == {"route": "/x"}


def test_deny_and_unknown_requests() -> None:
    _, page, leaf = make_tree()
    page.deny(leaf, "navigate")
    assert leaf.request("navigate", route="/x") == Response.DENIED
    assert leaf.request("custom") == Response.UNHANDLED
    page.handle(leaf, "custom", lambda request: Response.HANDLED)
    assert leaf.request("custom") == Response.HANDLED


def test_requests_without_a_live_host_report_gone() -> None:
    root = Node("root")
    leaf = Node("button")
    root.add(leaf)
    root.forward(leaf, "focus")
    assert leaf.request("focus") == Response.HOST_GONE
    assert Node("button").request("focus") == Response.HOST_GONE


def test_request_invalidated_by_move_reports_host_moved() -> None:
    app, page, leaf = make_tree()
    target = Node("page")
    app.add(target)

    def handler(request: Request) -> Response:
        page.move(leaf, target)
        return Response.HANDLED

    page.handle(leaf, "focus", handler)
    assert leaf.request("focus") == Response.HOST_MOVED


def test_request_invalidated_by_remove_reports_host_gone() -> None:
    _, page, leaf = make_tree()

    def handler(request: Request) -> Response:
        page.remove(leaf)
        return Response.HANDLED

    page.handle(leaf, "focus", handler)
    assert leaf.request("focus") == Response.HOST_GONE


def test_capability_grant_use_and_revoke() -> None:
    _, page, leaf = make_tree()
    assert host_of(leaf).capability("navigation") is None
    page.grant(leaf, "navigation")
    page.handle(leaf, "navigate", lambda request: Response.HANDLED)
    port = host_of(leaf).capability("navigation")
    assert port is not None
    assert port.navigate("/ideas") == Response.HANDLED
    page.revoke(leaf, "navigation")
    assert error_of(lambda: port.navigate("/ideas")).code == "E-SCOPE-CAPABILITY-REVOKED"
    assert (
        error_of(lambda: host_of(leaf).capability("navigation")).code
        == "E-SCOPE-CAPABILITY-REVOKED"
    )


def test_each_capability_port_maps_to_its_standard_request() -> None:
    _, page, leaf = make_tree()
    seen: list[tuple[str, dict[str, Any]]] = []

    def record(request: Request) -> Response:
        seen.append((request.name, dict(request.fields)))
        return Response.HANDLED

    for capability in CAPABILITY_TYPES:
        page.grant(leaf, capability)
    for request_name in STANDARD_REQUESTS:
        page.handle(leaf, request_name, record)
    host = host_of(leaf)
    navigation = host.capability("navigation")
    overlay = host.capability("overlay")
    focus = host.capability("focus")
    scroll = host.capability("scroll")
    data = host.capability("data")
    assert navigation is not None
    assert overlay is not None
    assert focus is not None
    assert scroll is not None
    assert data is not None
    assert navigation.navigate("/ideas") == Response.HANDLED
    assert overlay.open("dialog", {"title": "x"}) == Response.HANDLED
    assert focus.focus() == Response.HANDLED
    assert scroll.into_view() == Response.HANDLED
    assert data.get("ideas", "feed") == Response.HANDLED
    assert seen == [
        ("navigate", {"route": "/ideas"}),
        ("open_overlay", {"kind": "dialog", "props": {"title": "x"}}),
        ("focus", {}),
        ("scroll_into_view", {}),
        ("request_data", {"source": "ideas", "key": "feed"}),
    ]


def test_move_revokes_old_capability_and_new_parent_regrants() -> None:
    app, page, leaf = make_tree()
    target = Node("page")
    app.add(target)
    page.grant(leaf, "navigation")
    old_port = host_of(leaf).capability("navigation")
    page.handle(leaf, "navigate", lambda request: Response.HANDLED)
    assert old_port is not None

    page.move(leaf, target)

    assert error_of(lambda: old_port.navigate("/x")).code == "E-SCOPE-HOST-MOVED"
    assert host_of(leaf).capability("navigation") is None
    target.grant(leaf, "navigation")
    target.handle(leaf, "navigate", lambda request: Response.HANDLED)
    new_port = host_of(leaf).capability("navigation")
    assert new_port is not None
    assert new_port.navigate("/x") == Response.HANDLED


def test_capability_port_dies_with_its_host() -> None:
    _, page, leaf = make_tree()
    page.grant(leaf, "focus")
    child_host = host_of(leaf)
    port = child_host.capability("focus")
    assert port is not None
    page.remove(leaf)
    assert error_of(port.focus).code == "E-SCOPE-HOST-GONE"
    assert error_of(lambda: child_host.capability("focus")).code == "E-SCOPE-HOST-GONE"
