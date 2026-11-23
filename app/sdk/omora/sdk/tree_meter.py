"""构建 / 组合 / 差分的节点计数：复杂度护栏的尺子。

只数“被处理过几个节点”，不测时间：时间受机器与负载影响，进 CI 会抖；
计数是确定的，而且能直接回答“改一个节点，为什么处理了整页”。

计量只在 `measuring()` 里生效；默认关闭时每次 bump 只读一次 ContextVar，
不改变产线行为。三个阶段的含义：

- `build`：legacy Node → `dendro.tree/1` 节点记录（`tree_build._node_record`）；
- `compose`：局部树挂进 base 的遍历（`tree_build.compose`，校验 + 排序各一遍）；
- `walk`：差分前的文档遍历（`tree_diff._walk`，`needs_full` 与 `diff_documents` 各两遍）。
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field

STAGES = ("build", "compose", "walk")


@dataclass
class TreeMeter:
    """一次计量的累计值；`counts` 按阶段分开，`total` 是三个阶段之和。"""

    counts: dict[str, int] = field(default_factory=lambda: dict.fromkeys(STAGES, 0))

    def bump(self, stage: str) -> None:
        if stage not in self.counts:
            raise ValueError(f"未知阶段: {stage}")
        self.counts[stage] += 1

    @property
    def total(self) -> int:
        """这一轮处理过的节点次数（同一节点在不同阶段会各算一次）。"""
        return sum(self.counts.values())


_METER: ContextVar[TreeMeter | None] = ContextVar("omora_tree_meter", default=None)


def bump(stage: str) -> None:
    """记一次节点处理；没有开计量时什么都不做。"""
    meter = _METER.get()
    if meter is not None:
        meter.bump(stage)


@contextmanager
def measuring() -> Iterator[TreeMeter]:
    """开一段计量；退出时恢复外层计量（嵌套时各自独立）。"""
    meter = TreeMeter()
    token = _METER.set(meter)
    try:
        yield meter
    finally:
        _METER.reset(token)


__all__ = ["STAGES", "TreeMeter", "bump", "measuring"]
