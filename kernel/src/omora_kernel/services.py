"""服务注册表：声明依赖、按注册序拓扑解析，并把生命周期挂到作用域上。

工厂按解析顺序被调用，声明的依赖按顺序作为位置参数传入。解析在创建任何实例之前
完成：缺失依赖与循环依赖都会在激活开始前失败，不会留下半激活的注册表。
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from .context import Context, Lifecycle, UnavailableError

ServiceFactory = Callable[..., object]


class CircularDependencyError(RuntimeError):
    """服务依赖成环；在解析阶段立即失败。"""

    def __init__(self, cycle: tuple[str, ...]) -> None:
        self.cycle = cycle
        super().__init__("服务依赖成环: " + " -> ".join(cycle))


@dataclass(frozen=True)
class ServiceSpec:
    """一条服务注册：名字、工厂，以及工厂按位置顺序接收的依赖服务名。"""

    name: str
    factory: ServiceFactory
    dependencies: tuple[str, ...] = ()


class ServiceRegistry:
    """服务名到工厂的注册表；注册顺序决定无依赖服务的解析顺序。"""

    def __init__(self) -> None:
        self._specs: dict[str, ServiceSpec] = {}

    def register(self, spec: ServiceSpec) -> None:
        """登记服务；同名重复登记视为错误。"""
        if spec.name in self._specs:
            raise ValueError(f"服务 {spec.name!r} 已注册")
        self._specs[spec.name] = spec

    def resolution_order(self) -> tuple[str, ...]:
        """按注册序深度优先拓扑排序；依赖在前，同层按登记顺序。"""
        ordered: list[str] = []
        visited: set[str] = set()
        path: list[str] = []

        def visit(name: str) -> None:
            if name in path:
                start = path.index(name)
                raise CircularDependencyError((*path[start:], name))
            if name in visited:
                return
            visited.add(name)
            path.append(name)
            for dependency in self._specs[name].dependencies:
                if dependency not in self._specs:
                    raise UnavailableError(dependency, f"服务 {name!r} 的依赖未注册")
                visit(dependency)
            path.pop()
            ordered.append(name)

        for name in self._specs:
            visit(name)
        return tuple(ordered)

    async def activate(self, scope: Context) -> None:
        """按解析顺序创建并激活服务，绑定到作用域，并登记逆序释放。"""
        order = self.resolution_order()
        instances: dict[str, object] = {}
        for name in order:
            dependencies = [instances[item] for item in self._specs[name].dependencies]
            instances[name] = self._specs[name].factory(*dependencies)
        for name in order:
            scope.provide(name, instances[name])
        for name in order:
            instance = instances[name]
            if isinstance(instance, Lifecycle):
                await instance.activate()
                scope.on_dispose(instance.dispose)
