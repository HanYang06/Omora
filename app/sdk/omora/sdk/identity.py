"""身份编码：本地 code 与全链 addr 的确定性派生。

code 是节点在兄弟范围内的本地身份；addr 是从根到节点的滚动哈希：

    code(node) = short_code(stable_seed)
    addr(node) = chain_addr(addr(parent), code(node))

两者都是纯函数；内容变化不改种子，因此不改 code/addr。
静态节点的种子在构建期已知，code/addr 可以常量折叠。
"""

from __future__ import annotations

import base64
import hashlib
import hmac

_SEPARATOR = "\x1f"
_SHORT_BYTES = 10
_ADDR_BYTES = 10


def _b32(data: bytes) -> str:
    return base64.b32encode(data).decode("ascii").lower().rstrip("=")


def short_code(seed: str) -> str:
    """稳定种子 → 16 字符本地身份编码。

    用 SHA-256 截前 10 字节；同一个种子永远得到同一个 code。
    种子必须由调用方保证在兄弟范围内稳定（数据 key / 作者 key / 静态路径）。
    """
    if not isinstance(seed, str) or seed == "":
        raise ValueError("identity.seed 必须是非空字符串")
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    return _b32(digest[:_SHORT_BYTES])


def chain_addr(parent_addr: str | None, code: str) -> str:
    """父 addr + 本地 code → 子 addr；根节点 parent 传 None/空串。"""
    if parent_addr is not None and not isinstance(parent_addr, str):
        raise ValueError("identity.parent_addr 必须是字符串或 None")
    if not isinstance(code, str) or code == "":
        raise ValueError("identity.code 必须是非空字符串")
    seed = (parent_addr or "") + _SEPARATOR + code
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    return _b32(digest[:_ADDR_BYTES])


def node_identity(parent_addr: str | None, seed: str) -> tuple[str, str]:
    """返回 (code, addr)，便于一次调用。"""
    code = short_code(seed)
    return code, chain_addr(parent_addr, code)


def same_code(left: str, right: str) -> bool:
    """常量时间比较，便于测试/诊断；不是安全边界。"""
    return hmac.compare_digest(left, right)


__all__ = ["chain_addr", "node_identity", "same_code", "short_code"]
