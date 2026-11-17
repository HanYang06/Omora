"""页面层：Page 是 root Node scope，带页面元数据、私有 mutable state、显式 mount/invalidate。

契约唯一来源 `schema/sdk/page.json`。这不是 React：
- Page 是 retained 对象 + 显式 mount/invalidate，没有 `render(state)` 纯函数；
  invalidate 只重算 When/Bind，不重跑页面函数、不重建整页。
- When 挂在节点上，用一个稳定容器承接 then/otherwise 分支；只影响该容器子树。
- Bind 单向向下：`node.props[prop] ← page.state 路径 / page.data key`，
  mount/invalidate 时更新，不反向写。
- Action 由页面注册、显式 invoke：handler 改 page.state 后页面自动 invalidate；
  子节点拿不到 Page，不能直接改页面 state（只能通过 action/请求）。
- 节点事件：`page.on(node, event, action)` 把事件绑到已注册 action，
  `page.event(node, event, payload)` 触发 handler(page, payload) 并自动 invalidate；
  等价于树里 tree.on 的 handler id。

UI 组件与 tree 序列化不在这一层。
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any

from .scope import Node

Condition = Callable[["Page"], bool]


@dataclass(frozen=True, slots=True)
class When:
    """挂在节点上的条件：用一个稳定 container 承接 then/otherwise 分支。"""

    container: Node
    condition: Condition
    then: tuple[Node, ...]
    otherwise: tuple[Node, ...]


@dataclass(frozen=True, slots=True)
class Bind:
    """单向绑定：`node.props[prop]` ← page 的 state 路径 / data key。"""

    node: Node
    prop: str
    source: str


@dataclass(frozen=True, slots=True)
class Action:
    """页面动作：name 对应树上的事件 handler id；handler 负责改 page.state。"""

    name: str
    handler: Callable[..., None]


@dataclass(slots=True)
class _WhenSlot:
    """一次 When 注册的运行时状态：当前挂着的分支（节点对象身份稳定）。"""

    when: When
    active: tuple[Node, ...] = field(default_factory=tuple)


def _lookup(root: Mapping[str, Any], path: str) -> Any:
    """按点分路径取值；缺路径返回 None，让绑定可以等状态就绪。"""
    current: Any = root
    for part in path.split("."):
        if not isinstance(current, Mapping) or part not in current:
            return None
        current = current[part]
    return current


def _nodes(values: Iterable[Node]) -> tuple[Node, ...]:
    return tuple(values)


class Page:
    """一个页面作用域：root Node + 页面元数据 + 私有 state/data + When/Bind/Action。

    显式生命周期：`mount(host)` 才解析 When/Bind；`unmount()` 走 scope 的 root unmount
    （关 host、保留子树），再次 mount 会把保留的树重新激活。`invalidate()` 只在已挂载时
    重算，并且只动 When 容器与 Bind 目标节点，不重建整页。
    """

    def __init__(  # noqa: PLR0913 —— 页面字段与 page.json 一一对应
        self,
        name: str,
        root: Node,
        *,
        label: str = "",
        icon: str = "",
        state: Mapping[str, Any] | None = None,
        data: Mapping[str, Any] | None = None,
    ) -> None:
        if not isinstance(name, str) or name == "":
            raise ValueError("页面 name 必须是非空字符串")
        if not isinstance(root, Node):
            raise TypeError("root 必须是 Node")
        self._name = name
        self._root = root
        self._label = label
        self._icon = icon
        self._state: dict[str, Any] = dict(state or {})
        self._data: dict[str, Any] = dict(data or {})
        self._whens: list[_WhenSlot] = []
        self._binds: list[Bind] = []
        self._actions: dict[str, Action] = {}
        self._node_events: dict[Node, dict[str, str]] = {}
        self._mounted = False
        self._host: object | None = None

    # ---- 只读视图 ----
    @property
    def name(self) -> str:
        return self._name

    @property
    def label(self) -> str:
        return self._label

    @property
    def icon(self) -> str:
        return self._icon

    @property
    def root(self) -> Node:
        return self._root

    @property
    def mounted(self) -> bool:
        return self._mounted

    @property
    def host(self) -> object | None:
        return self._host

    @property
    def state(self) -> Mapping[str, Any]:
        """只读视图；页面自己/action 通过 update_state 改。"""
        return MappingProxyType(self._state)

    @property
    def data(self) -> Mapping[str, Any]:
        return MappingProxyType(self._data)

    @property
    def actions(self) -> Mapping[str, Action]:
        return MappingProxyType(self._actions)

    # ---- 显式生命周期 ----
    def mount(self, host: object | None = None) -> Page:
        """显式挂载：激活保留的树并解析全部 When/Bind；host 由引擎/测试提供。"""
        if self._mounted:
            return self
        if self._root.disposed:
            raise ValueError("页面 root 已销毁，不能 mount")
        self._host = host
        self._root._reactivate()
        self._mounted = True
        self._evaluate()
        return self

    def unmount(self) -> Page:
        """显式卸载：root-only 关 host、保留子树与 parent 链。"""
        if not self._mounted:
            return self
        self._root.unmount()
        self._mounted = False
        self._host = None
        return self

    def invalidate(self) -> Page:
        """重新解析 When/Bind；未挂载时是 no-op（不提前改树）。"""
        if self._mounted:
            self._evaluate()
        return self

    # ---- 页面私有 state / data ----
    def update_state(
        self,
        changes: Mapping[str, Any] | None = None,
        **updates: Any,
    ) -> None:
        if changes is not None:
            self._state.update(changes)
        self._state.update(updates)

    def update_data(
        self,
        changes: Mapping[str, Any] | None = None,
        **updates: Any,
    ) -> None:
        if changes is not None:
            self._data.update(changes)
        self._data.update(updates)

    # ---- When / Bind / Action 注册 ----
    def when(
        self,
        container: Node,
        condition: Condition,
        *,
        then: Iterable[Node] = (),
        otherwise: Iterable[Node] = (),
    ) -> When:
        self._require_in_page(container)
        then_nodes = _nodes(then)
        else_nodes = _nodes(otherwise)
        for node in (*then_nodes, *else_nodes):
            if not isinstance(node, Node):
                raise TypeError("When 分支必须是 Node")
            if node._parent is not None:
                raise ValueError("When 分支节点必须是 detached 的")
        when = When(
            container=container,
            condition=condition,
            then=then_nodes,
            otherwise=else_nodes,
        )
        slot = _WhenSlot(when=when)
        self._whens.append(slot)
        if self._mounted:
            self._resolve(slot)
        return when

    def bind(self, node: Node, prop: str, source: str) -> Bind:
        if not isinstance(prop, str) or prop == "":
            raise ValueError("Bind prop 必须是非空字符串")
        if not isinstance(source, str) or source == "":
            raise ValueError("Bind source 必须是非空字符串")
        self._require_in_page(node)
        binding = Bind(node=node, prop=prop, source=source)
        self._binds.append(binding)
        if self._mounted:
            self._apply(binding)
        return binding

    def register(self, action: Action) -> Action:
        if action.name in self._actions:
            raise ValueError(f"重复的页面 action: {action.name}")
        self._actions[action.name] = action
        return action

    def action(self, name: str, handler: Callable[..., None]) -> Action:
        return self.register(Action(name=name, handler=handler))

    def invoke(self, name: str, *args: Any, **kwargs: Any) -> None:
        """调用页面 action：handler 改 state 后自动 invalidate，树上事件只需给 name。"""
        action = self._actions.get(name)
        if action is None:
            raise KeyError(f"未知页面 action: {name}")
        action.handler(self, *args, **kwargs)
        self.invalidate()

    # ---- 节点事件绑定：等价于树里 tree.on 的 handler id ----
    def on(self, node: Node, event: str, action: str) -> None:
        """把节点事件绑到已注册 action；同一 (node, event) 重复绑定以后者为准。"""
        if not isinstance(node, Node):
            raise TypeError("on 的 node 必须是 Node")
        self._require_in_page(node)
        if not isinstance(event, str) or event == "":
            raise ValueError("事件名必须是非空字符串")
        if action not in self._actions:
            raise KeyError(f"未知页面 action: {action}")
        bindings = self._node_events.setdefault(node, {})
        bindings[event] = action

    def event(self, node: Node, event: str, payload: Any = None) -> None:
        """触发节点事件：handler 收到 (page, payload)，结束后页面自动 invalidate。"""
        if not isinstance(node, Node):
            raise TypeError("event 的 node 必须是 Node")
        self._require_in_page(node)
        bindings = self._node_events.get(node)
        action = None if bindings is None else bindings.get(event)
        if action is None:
            raise KeyError(f"节点上没有事件绑定: {event}")
        self.invoke(action, payload)

    # ---- 内部：求值与范围校验 ----
    def _evaluate(self) -> None:
        for binding in self._binds:
            self._apply(binding)
        for slot in self._whens:
            self._resolve(slot)

    def _apply(self, binding: Bind) -> None:
        value = self._source_value(binding.source)
        props = binding.node.props
        if binding.prop in props and props[binding.prop] == value:
            return
        binding.node.patch(props={binding.prop: value})

    def _resolve(self, slot: _WhenSlot) -> None:
        when = slot.when
        branch = when.then if when.condition(self) else when.otherwise
        if branch == slot.active:
            return
        for node in slot.active:
            if node._parent is when.container:
                when.container.remove(node)
        for node in branch:
            if node._parent is not when.container:
                when.container.add(node)
        slot.active = branch

    def _source_value(self, source: str) -> Any:
        if source.startswith("state."):
            return _lookup(self._state, source[len("state.") :])
        if source.startswith("data."):
            return _lookup(self._data, source[len("data.") :])
        return _lookup(self._state, source)

    def _require_in_page(self, node: object) -> None:
        if not isinstance(node, Node):
            raise TypeError("When/Bind 目标必须是 Node")
        current: Node | None = node
        while current is not None:
            if current is self._root:
                return
            current = current._parent
        raise ValueError("When/Bind 目标必须属于该页面的 root 子树")
