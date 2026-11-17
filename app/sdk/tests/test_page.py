"""Page 层行为测试：显式 mount/invalidate、When 切换、Bind 单向更新、Action 改 state、卸载。"""

from __future__ import annotations

from typing import Any, cast

import pytest

from omora.sdk.authoring import Node, Page, ParentRef

ROOT_KIND = "page"


class FakeHost:
    """测试用宿主占位：Page 只把它记录为 mount 端点，不接引擎。"""

    def __init__(self) -> None:
        self.closed = False

    def close(self) -> None:
        self.closed = True


def make_page(
    *,
    state: dict[str, Any] | None = None,
    data: dict[str, Any] | None = None,
) -> tuple[Page, Node, Node]:
    root = Node(ROOT_KIND)
    container = Node("column")
    bindable = Node("text")
    root.add(container)
    root.add(bindable)
    page = Page(
        "feed",
        root,
        label="Feed",
        icon="list",
        state=state or {},
        data=data or {},
    )
    return page, container, bindable


def test_page_exposes_metadata_and_page_private_state() -> None:
    page, _, _ = make_page(state={"open": False})

    assert page.name == "feed"
    assert page.label == "Feed"
    assert page.icon == "list"
    assert page.root.kind == ROOT_KIND
    assert page.mounted is False
    assert dict(page.state) == {"open": False}

    with pytest.raises(TypeError):
        cast(dict[str, Any], page.state)["open"] = True

    child = Node("text")
    page.root.add(child)
    child.patch(state={"open": True})
    assert dict(page.state) == {"open": False}

    page.update_state({"open": True})
    assert page.state["open"] is True


def test_page_mounts_with_a_fake_host_and_unmount_keeps_the_subtree() -> None:
    page, container, _ = make_page()
    branch = Node("text")
    page.when(container, lambda page: True, then=[branch])
    host = FakeHost()

    assert page.mounted is False
    assert branch.parent is None

    page.mount(host)

    assert page.mounted is True
    assert page.host is host
    assert branch.parent == ParentRef(id=container.id, kind=container.kind)
    assert branch.mounted is True

    page.unmount()

    assert page.mounted is False
    assert page.host is None
    assert page.root.children[0] is container
    assert branch.parent == ParentRef(id=container.id, kind=container.kind)
    assert branch.mounted is False


def test_when_switches_branch_on_invalidate_with_a_stable_container() -> None:
    page, container, _ = make_page()
    opened = Node("panel")
    closed = Node("empty")
    page.when(
        container,
        lambda page: bool(page.state.get("open")),
        then=[opened],
        otherwise=[closed],
    )

    page.mount()

    assert container.children == (closed,)
    container_id = container.id

    page.update_state({"open": True})
    assert container.children == (closed,)

    page.invalidate()

    assert container.children == (opened,)
    assert container.id == container_id
    assert page.root.children[0] is container
    assert closed.parent is None


def test_when_only_touches_its_own_subtree() -> None:
    page, container, bindable = make_page()
    sibling = Node("text")
    page.root.add(sibling)
    sibling_host = sibling.host
    opened = Node("panel")
    page.when(container, lambda page: bool(page.state.get("open")), then=[opened])

    page.mount()
    page.update_state({"open": True})
    page.invalidate()

    assert container.children == (opened,)
    assert sibling.host is sibling_host
    assert sibling.mounted is True
    assert bindable.host is not None
    assert dict(bindable.props) == {}


def test_bind_updates_prop_from_state_path_on_mount_and_invalidate() -> None:
    page, _, bindable = make_page(state={"title": "A"})
    page.bind(bindable, "text", "state.title")
    assert dict(bindable.props) == {}

    page.mount()
    assert bindable.props["text"] == "A"

    page.update_state({"title": "B"})
    assert bindable.props["text"] == "A"

    page.invalidate()
    assert bindable.props["text"] == "B"


def test_bind_reads_data_keys_and_missing_sources_are_none() -> None:
    page, _, bindable = make_page(data={"query": "abc"})
    page.bind(bindable, "value", "data.query")
    page.bind(bindable, "hint", "state.missing.deep")

    page.mount()
    assert bindable.props["value"] == "abc"
    assert bindable.props["hint"] is None

    page.update_data({"query": "xyz"})
    page.invalidate()
    assert bindable.props["value"] == "xyz"


def test_action_mutates_page_state_then_invalidates() -> None:
    page, container, bindable = make_page(state={"open": False, "title": "A"})
    opened = Node("panel")
    closed = Node("empty")
    page.when(
        container,
        lambda page: bool(page.state.get("open")),
        then=[opened],
        otherwise=[closed],
    )
    page.bind(bindable, "text", "state.title")

    def toggle(page: Page) -> None:
        page.update_state({"open": not page.state["open"], "title": "B"})

    page.action("toggle", toggle)
    page.mount()
    assert container.children == (closed,)

    page.invoke("toggle")

    assert page.state["open"] is True
    assert container.children == (opened,)
    assert bindable.props["text"] == "B"

    with pytest.raises(KeyError):
        page.invoke("missing")


def test_when_and_bind_targets_must_be_inside_the_page_subtree() -> None:
    page, container, _ = make_page()
    foreign = Node("text")

    with pytest.raises(ValueError, match="root 子树"):
        page.when(foreign, lambda page: True, then=[Node("x")])
    with pytest.raises(ValueError, match="root 子树"):
        page.bind(foreign, "text", "state.x")

    attached = Node("text")
    page.root.add(attached)
    with pytest.raises(ValueError, match="detached"):
        page.when(container, lambda page: True, then=[attached])


def test_invalidate_before_mount_is_a_noop_and_remount_restores_the_branch() -> None:
    page, container, bindable = make_page(state={"title": "A"})
    branch = Node("text")
    page.when(container, lambda page: True, then=[branch])
    page.bind(bindable, "text", "state.title")

    page.invalidate()
    assert not container.children

    page.mount()
    assert container.children == (branch,)
    assert branch.mounted is True

    page.unmount()
    assert branch.mounted is False

    page.update_state({"title": "B"})
    page.mount()

    assert page.mounted is True
    assert branch.mounted is True
    assert bindable.props["text"] == "B"


def test_page_requires_a_name_and_a_root_node() -> None:
    with pytest.raises(ValueError, match="name"):
        Page("", Node("page"))
    with pytest.raises(TypeError, match="Node"):
        Page("feed", cast(Any, "not-a-node"))


def test_registrations_after_mount_apply_immediately_and_properties_are_read_only() -> None:
    page, container, bindable = make_page(state={"title": "A"}, data={"q": "x"})
    page.mount()

    late = Node("text")
    page.when(container, lambda page: True, then=[late])
    page.bind(bindable, "text", "title")

    assert container.children == (late,)
    assert bindable.props["text"] == "A"
    assert dict(page.data) == {"q": "x"}
    assert dict(page.actions) == {}

    page.mount()
    assert page.mounted is True

    page.unmount()
    page.unmount()
    assert page.mounted is False


def test_invalid_when_bind_and_action_registrations_are_rejected() -> None:
    page, container, _ = make_page()

    with pytest.raises(TypeError, match="When/Bind 目标"):
        page.when(cast(Any, "not-node"), lambda page: True)
    with pytest.raises(TypeError, match="When 分支"):
        page.when(container, lambda page: True, then=[cast(Any, "not-node")])
    with pytest.raises(ValueError, match="Bind prop"):
        page.bind(container, "", "state.x")
    with pytest.raises(ValueError, match="Bind source"):
        page.bind(container, "text", "")

    page.action("dup", lambda page: None)
    with pytest.raises(ValueError, match="重复的页面 action"):
        page.action("dup", lambda page: None)


def test_page_cannot_mount_after_root_dispose() -> None:
    page, _, _ = make_page()
    page.root.dispose()

    with pytest.raises(ValueError, match="已销毁"):
        page.mount()
