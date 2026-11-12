"""快照增量：两次快照之间能表达的 set / insert / remove。

路径从快照根算，op 形状见 docs/design/protocol.md §6。补丁只省解析、不省渲染，
所以没变的子树必须原样复用（引用相等）：渲染端按节点引用 memo，整棵重建会让它失效。

输入是 ui 自己刚画出来的两份快照（同一个 page），所以节点形状可信；
唯一算不出来的情况是换页——那时候客户端手里是另一棵视图树。
"""

from __future__ import annotations

from typing import Any

Op = dict[str, Any]
Path = list[Any]


def diff_snapshot(
    previous: dict[str, Any], current: dict[str, Any]
) -> tuple[list[Op], dict[str, Any]] | None:
    """算出 previous → current 的补丁；换页（算不出来）返回 None，调用方改推全量。

    返回 (ops, merged)：merged 是客户端应用完补丁之后的样子，没变的子树直接复用
    previous / current 里的对象，下一次 diff 的基准就是它。
    """
    if previous.get("page") != current.get("page"):
        return None

    ops: list[Op] = []
    merged: dict[str, Any] = {}
    for key, value in current.items():
        if key == "version":
            merged[key] = previous.get("version")
        elif key == "content":
            merged[key] = _diff_node(previous[key], value, [key], ops)
        elif key == "contributions":
            merged[key] = _diff_contributions(previous.get(key) or [], value or [], [key], ops)
        elif previous.get(key) == value:
            merged[key] = previous[key]
        else:
            ops.append({"op": "set", "path": [key], "value": value})
            merged[key] = value
    return ops, merged


def _identity(item: dict[str, Any]) -> tuple[Any, ...]:
    """贡献的身份：同一插件、同一落点、同一动作、同一声明序号。"""
    return (item.get("owner"), item.get("target"), item.get("op"), item.get("seq", 0))


def _diff_contributions(
    previous: list[Any], current: list[Any], path: Path, ops: list[Op]
) -> list[Any]:
    """贡献列表：成员没变就逐份 diff，成员变了整表替换（只影响这一块）。"""
    if previous is current or previous == current:
        return previous
    if [_identity(item) for item in previous] != [_identity(item) for item in current]:
        ops.append({"op": "set", "path": path, "value": current})
        return current
    return [
        _diff_contribution(old, new, [*path, index], ops)
        for index, (old, new) in enumerate(zip(previous, current, strict=True))
    ]


def _diff_contribution(
    previous: dict[str, Any], current: dict[str, Any], path: Path, ops: list[Op]
) -> dict[str, Any]:
    """一份贡献：树走节点 diff，其余字段按值改；少字段只能整份换掉。"""
    if previous == current:
        return previous
    if set(previous) - set(current):
        ops.append({"op": "set", "path": path, "value": current})
        return current
    merged: dict[str, Any] = {}
    for key, value in current.items():
        if key == "tree":
            merged[key] = _diff_node(previous.get("tree") or {}, value or {}, [*path, "tree"], ops)
        elif previous.get(key) == value:
            merged[key] = previous[key]
        else:
            ops.append({"op": "set", "path": [*path, key], "value": value})
            merged[key] = value
    return merged


def _diff_node(
    previous: dict[str, Any], current: dict[str, Any], path: Path, ops: list[Op]
) -> dict[str, Any]:
    """一个节点：能按字段改就按字段改，否则整颗换掉。

    整颗换掉只发生在两种地方：节点类型变了、少了一个 prop（协议里没有删字段的 op）。
    两种都只换这颗节点，兄弟节点仍然与原快照共享引用。
    """
    if previous is current or previous == current:
        return previous
    if previous.get("type") != current.get("type"):
        ops.append({"op": "set", "path": path, "value": current})
        return current

    old_props: dict[str, Any] = previous.get("props") or {}
    new_props: dict[str, Any] = current.get("props") or {}
    if set(old_props) - set(new_props):
        ops.append({"op": "set", "path": path, "value": current})
        return current
    for name, value in new_props.items():
        if name not in old_props or old_props[name] != value:
            ops.append({"op": "set", "path": [*path, "props", name], "value": value})
    props = previous["props"] if old_props == new_props else dict(new_props)

    old_children: list[Any] = previous.get("children") or []
    new_children: list[Any] = current.get("children") or []
    children = _diff_children(old_children, new_children, [*path, "children"], ops)

    return {"type": current.get("type"), "props": props, "children": children}


def _diff_children(previous: list[Any], current: list[Any], path: Path, ops: list[Op]) -> list[Any]:
    """一串子节点：相同的掐头去尾，中间按位配对，多出来的插 / 删。

    掐头去尾留下的部分直接复用旧列表里的元素引用；配对的递归下去按字段改。
    """
    if previous is current or previous == current:
        return previous

    prefix = 0
    shortest = min(len(previous), len(current))
    while prefix < shortest and previous[prefix] == current[prefix]:
        prefix += 1
    suffix = 0
    while (
        suffix < len(previous) - prefix
        and suffix < len(current) - prefix
        and previous[-1 - suffix] == current[-1 - suffix]
    ):
        suffix += 1

    old_middle = previous[prefix : len(previous) - suffix]
    new_middle = current[prefix : len(current) - suffix]
    merged: list[Any] = list(previous[:prefix])

    paired = min(len(old_middle), len(new_middle))
    merged.extend(
        _diff_node(old_middle[index], new_middle[index], [*path, prefix + index], ops)
        for index in range(paired)
    )
    # 多出来的新节点：从配对结束处往后插，index 随插入次数增长。
    for index in range(paired, len(new_middle)):
        ops.append(
            {"op": "insert", "path": path, "index": prefix + index, "value": new_middle[index]}
        )
        merged.append(new_middle[index])
    # 多出来的旧节点：反复删同一个位置。
    ops.extend(
        {"op": "remove", "path": path, "index": prefix + paired}
        for _ in range(len(old_middle) - paired)
    )

    merged.extend(previous[len(previous) - suffix :])
    return merged
