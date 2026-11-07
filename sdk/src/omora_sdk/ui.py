"""C3 节点的构造助手:插件用它们产出声明式界面,而不是拼接字典。

节点是数据,不是代码。以 `$` 开头的字符串是绑定:它在贡献者自己的状态切片里求值,
列表项内部额外有 `$item` 作用域。
"""

from __future__ import annotations

from collections.abc import Sequence

Node = dict[str, object]


def stack(children: Sequence[Node], *, direction: str = "vertical", gap: int = 0) -> Node:
    """纵向或横向堆叠子节点。"""
    return {
        "type": "Stack",
        "props": {"direction": direction, "gap": gap},
        "children": list(children),
    }


def text(value: str, *, variant: str = "body") -> Node:
    """一段文本;value 可以是绑定表达式。"""
    return {"type": "Text", "props": {"text": value, "variant": variant}}


def button(
    label: str,
    *,
    command: str,
    args: dict[str, object] | None = None,
    variant: str = "primary",
    disabled: bool = False,
) -> Node:
    """按钮;点击只能发命令,不能内联逻辑。"""
    click: dict[str, object] = {"command": command}
    if args is not None:
        click["args"] = args
    return {
        "type": "Button",
        "props": {"label": label, "variant": variant, "disabled": disabled},
        "on": {"click": click},
    }


def input_(
    placeholder: str = "",
    *,
    value: str = "",
    submit: str | None = None,
    args: dict[str, object] | None = None,
) -> Node:
    """单行输入;提交时发命令,args 里的绑定在提交那一刻求值($value 是当前文本)。"""
    node: Node = {"type": "Input", "props": {"placeholder": placeholder, "value": value}}
    if submit is not None:
        action: dict[str, object] = {"command": submit}
        if args is not None:
            action["args"] = args
        node["on"] = {"submit": action}
    return node


def list_(items: str, children: Sequence[Node], *, empty_text: str | None = None) -> Node:
    """按绑定到的数组重复渲染模板;items 必须是绑定表达式。"""
    props: dict[str, object] = {"items": items}
    if empty_text is not None:
        props["emptyText"] = empty_text
    return {"type": "List", "props": props, "children": list(children)}


def card(children: Sequence[Node], *, title: str | None = None) -> Node:
    """带边框的内容块。"""
    props: dict[str, object] = {}
    if title is not None:
        props["title"] = title
    return {"type": "Card", "props": props, "children": list(children)}
