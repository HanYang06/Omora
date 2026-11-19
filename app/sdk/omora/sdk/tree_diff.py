"""V1 文档差分：两份已 compose 的 dendro.tree/1 → 最小 ops。

只做结构能表达的那部分：settings 变化走 setProps，新增子树走 mount，消失子树走
unmount。顺序变化没有 move op，边界见 docs/engine/tree-ops.md；这里不悄悄造新 op。
"""

from __future__ import annotations

from collections.abc import Iterator
from copy import deepcopy
from typing import Any

Node = dict[str, Any]


def _walk(node: Node, parent: str | None) -> Iterator[tuple[str, Node, str | None]]:
    yield node["id"], node, parent
    for child in node["layout"]:
        yield from _walk(child, node["id"])
    for template in node.get("collection", {}).get("templates", {}).values():
        yield from _walk(template, node["id"])


def _index(document: Node) -> tuple[dict[str, Node], dict[str, str | None]]:
    nodes: dict[str, Node] = {}
    parents: dict[str, str | None] = {}
    for node_id, node, parent in _walk(document["root"], None):
        nodes[node_id] = node
        parents[node_id] = parent
    return nodes, parents


_STRUCT_FIELDS = ("kind", "chain", "title", "on", "a11y", "slot", "collection", "bind", "emit")


def needs_full(old: Node, new: Node) -> bool:
    """差分表达不了的变化：结构字段、order、同级相对顺序。命中就整树重挂。"""
    old_nodes, _ = _index(old)
    new_nodes, _ = _index(new)
    for node_id, node in new_nodes.items():
        before = old_nodes.get(node_id)
        if before is None:
            continue
        if any(node.get(field) != before.get(field) for field in _STRUCT_FIELDS):
            return True
        if node.get("order") != before.get("order"):
            return True
        old_order = [child["id"] for child in before["layout"] if child["id"] in new_nodes]
        new_order = [child["id"] for child in node["layout"] if child["id"] in old_nodes]
        if old_order != new_order:
            return True
    return False


def diff_documents(old: Node, new: Node) -> list[dict[str, Any]]:
    """old → new 的最小 ops；空列表表示只有版本推进。"""
    old_nodes, old_parents = _index(old)
    new_nodes, new_parents = _index(new)

    ops: list[dict[str, Any]] = []

    # 摘：只摘“父还在新树里”的最高层，子树由运行时一起卸。
    for node_id in old_nodes:
        if node_id in new_nodes:
            continue
        parent = old_parents[node_id]
        if parent is not None and parent in new_nodes:
            ops.append({"op": "unmount", "id": node_id})

    # 改：只比 settings；on / a11y / slot / collection 的变化不属于 setProps。
    for node_id, node in new_nodes.items():
        before = old_nodes.get(node_id)
        if before is None or node.get("settings") == before.get("settings"):
            continue
        ops.append({"op": "setProps", "id": node_id, "props": deepcopy(node["settings"])})

    # 挂：只挂“父已在旧树里”的最高层，子树随 node 一起带过去。
    for node_id, node in new_nodes.items():
        if node_id in old_nodes:
            continue
        parent = new_parents[node_id]
        if parent is not None and parent in old_nodes:
            ops.append({"op": "mount", "parent": parent, "node": deepcopy(node)})

    return ops


__all__ = ["diff_documents", "needs_full"]
