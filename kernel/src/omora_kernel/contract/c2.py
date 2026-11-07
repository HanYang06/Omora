"""C2 清单校验:先按 schema 校验形状,再校验宿主引擎兼容性。

两类失败分开:清单不合法(InvalidManifestError)与引擎不兼容
(EngineIncompatibleError)。宿主据此决定跳过还是记录,不混在一起。
"""

from __future__ import annotations

from collections.abc import Mapping

import jsonschema
from omora_sdk import Manifest, ManifestError, parse_manifest

from .. import __version__
from ..schema import load_schema

MANIFEST_SCHEMA = "c2-manifest.schema.json"

Semver = tuple[int, int, int]


class InvalidManifestError(ValueError):
    """清单不符合 C2 schema,或其中字段无法解析。"""

    code: str = "E_INVALID"


class EngineIncompatibleError(ValueError):
    """清单要求的宿主版本范围不包含当前宿主版本。"""

    code: str = "E_UNAVAILABLE"


def validate_manifest(data: Mapping[str, object]) -> Manifest:
    """校验清单并返回 SDK 视图;失败时抛出上面两类错误之一。"""
    _validate_schema(data)
    try:
        manifest = parse_manifest(data)
    except ManifestError as error:
        raise InvalidManifestError(str(error)) from error
    constraint = manifest.engines.get("omora")
    if constraint is None:
        raise InvalidManifestError("清单缺少 engines.omora")
    try:
        compatible = semver_satisfies(__version__, constraint)
    except ValueError as error:
        raise InvalidManifestError(f"engines.omora 范围无法解析: {constraint!r}") from error
    if not compatible:
        raise EngineIncompatibleError(
            f"插件 {manifest.id} 要求 omora {constraint},当前宿主 {__version__}"
        )
    return manifest


def semver_satisfies(version: str, constraint: str) -> bool:
    """判断 version 是否满足 constraint;支持 ^ ~ >= > <= < =、精确版本与 *。"""
    current = _parse_version(version)
    tokens = constraint.split()
    if not tokens:
        raise ValueError("版本范围不能为空")
    return all(_matches(current, token) for token in tokens)


def _validate_schema(data: Mapping[str, object]) -> None:
    schema = load_schema(MANIFEST_SCHEMA)
    try:
        jsonschema.validate(instance=data, schema=schema)
    except jsonschema.ValidationError as error:
        location = "/".join(str(part) for part in error.absolute_path) or "$"
        raise InvalidManifestError(f"清单不合法于 {location}: {error.message}") from error


def _matches(version: Semver, token: str) -> bool:
    if token in ("*", "x", "X"):
        return True
    if token.startswith("^"):
        lower = _parse_version(token[1:])
        return lower <= version < _caret_upper(lower)
    if token.startswith("~"):
        lower = _parse_version(token[1:])
        return lower <= version < _tilde_upper(lower)
    for operator in (">=", "<=", ">", "<", "="):
        if token.startswith(operator):
            return _compare(version, _parse_version(token[len(operator) :]), operator)
    return version == _parse_version(token)


def _compare(version: Semver, target: Semver, operator: str) -> bool:
    if operator == ">=":
        return version >= target
    if operator == "<=":
        return version <= target
    if operator == ">":
        return version > target
    if operator == "<":
        return version < target
    return version == target


def _caret_upper(lower: Semver) -> Semver:
    major, minor, patch = lower
    if major > 0:
        return (major + 1, 0, 0)
    if minor > 0:
        return (0, minor + 1, 0)
    return (0, 0, patch + 1)


def _tilde_upper(lower: Semver) -> Semver:
    major, minor, _ = lower
    return (major, minor + 1, 0)


def _parse_version(text: str) -> Semver:
    parts = text.strip().split(".")
    if len(parts) != 3 or not all(part.isdigit() for part in parts):
        raise ValueError(f"无法解析版本: {text!r}")
    values = [int(part) for part in parts]
    return (values[0], values[1], values[2])
