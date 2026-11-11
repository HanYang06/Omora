"""manager 的数据形状：阶段、原因、清单行。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ._metadata import Metadata

PENDING = "pending"
LOADING = "loading"
ACTIVE = "active"
FAILED = "failed"
DISABLED = "disabled"

PHASE_TEXT = {
    PENDING: "待装载",
    LOADING: "装载中",
    ACTIVE: "运行中",
    FAILED: "失败",
    DISABLED: "已禁用",
}


@dataclass(frozen=True)
class Reason:
    """一条可解释的原因；code 稳定，message 给人看。"""

    code: str
    message: str

    def to_dict(self) -> dict[str, str]:
        return {"code": self.code, "message": self.message}


@dataclass(frozen=True)
class Row:
    """清单里的一行：身份、元数据、生效开关、阶段、原因。"""

    name: str
    version: str
    description: str
    metadata: Metadata
    bootstrap: bool
    default_enabled: bool
    enabled: bool
    phase: str
    reason: Reason | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "version": self.version,
            "description": self.description,
            "bootstrap": self.bootstrap,
            "listed": self.metadata.listed,
            "default_enabled": self.default_enabled,
            "enabled": self.enabled,
            "phase": self.phase,
            "reason": None if self.reason is None else self.reason.to_dict(),
            "conditions": {
                "platforms": list(self.metadata.platforms),
                "capabilities": list(self.metadata.capabilities),
                "requires": list(self.metadata.requires),
            },
        }
