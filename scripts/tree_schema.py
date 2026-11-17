"""Generate Python/TS tree types from the canonical JSON Schema.

The schema is the only place fields/types live. Run:

    uv run python scripts/tree_schema.py            # write generated files
    uv run python scripts/tree_schema.py --check    # fail if generated files drift
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "schema" / "tree" / "tree.schema.json"
PY_OUT = ROOT / "app" / "sdk" / "omora" / "sdk" / "tree_generated.py"
TS_OUT = ROOT / "app" / "ui-engine" / "src" / "contract" / "tree_generated.ts"

PY_HEADER = '''"""生成物：树格式 V1 的 Python 类型与常量。不要手改。

来源：schema/tree/tree.schema.json；重新生成：
    uv run python scripts/tree_schema.py
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any
'''

TS_HEADER = """// 生成物：树格式 V1 的 TS 类型、常量与 schema。不要手改。
// 来源：schema/tree/tree.schema.json；重新生成：
//   uv run python scripts/tree_schema.py
"""


def load_schema() -> dict[str, Any]:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def ref_name(ref: str) -> str:
    name = ref.rsplit("/", 1)[-1]
    if name == "ledgerEntry":
        return "LedgerEntry"
    return name[:1].upper() + name[1:]


def py_type(  # noqa: PLR0911, PLR0912 —— schema 类型分派
    prop: dict[str, Any], defs: dict[str, Any]
) -> str:
    if "$ref" in prop:
        name = str(prop["$ref"]).rsplit("/", 1)[-1]
        if name in ("id", "chain"):
            return "str"
        return ref_name(str(prop["$ref"]))
    if "const" in prop:
        return "str" if isinstance(prop["const"], str) else "Any"
    if "allOf" in prop:
        for part in prop["allOf"]:
            if isinstance(part, dict) and "$ref" in part:
                return ref_name(str(part["$ref"]))
        return "Any"
    if "enum" in prop:
        return "str"
    kind = prop.get("type")
    if isinstance(kind, list):
        if set(kind) == {"string", "number"}:
            return "str | int | float"
        return "Any"
    if kind == "string":
        return "str"
    if kind == "integer":
        return "int"
    if kind == "number":
        return "float"
    if kind == "boolean":
        return "bool"
    if kind == "array":
        return f"tuple[{py_type(prop['items'], defs)}, ...]"
    if kind == "object":
        extra = prop.get("additionalProperties")
        if isinstance(extra, dict) and "$ref" in extra:
            return f"Mapping[str, {ref_name(str(extra['$ref']))}]"
        if isinstance(extra, dict) and extra.get("type") == "string":
            return "Mapping[str, str]"
        if prop.get("properties") and set(prop["properties"]) <= {"width", "height"}:
            return "Mapping[str, str | int | float]"
        return "Mapping[str, Any]"
    return "Any"


def ts_type(  # noqa: PLR0911, PLR0912 —— schema 类型分派
    prop: dict[str, Any], defs: dict[str, Any]
) -> str:
    if "$ref" in prop:
        name = str(prop["$ref"]).rsplit("/", 1)[-1]
        if name in ("id", "chain"):
            return "string"
        return ref_name(str(prop["$ref"]))
    if "const" in prop:
        return "string" if isinstance(prop["const"], str) else "unknown"
    if "allOf" in prop:
        for part in prop["allOf"]:
            if isinstance(part, dict) and "$ref" in part:
                return ref_name(str(part["$ref"]))
        return "unknown"
    if "enum" in prop:
        values = prop["enum"]
        if all(isinstance(value, str) for value in values):
            return " | ".join(json.dumps(value) for value in values)
        return "unknown"
    kind = prop.get("type")
    if isinstance(kind, list):
        if set(kind) == {"string", "number"}:
            return "string | number"
        return "unknown"
    if kind == "string":
        return "string"
    if kind in ("integer", "number"):
        return "number"
    if kind == "boolean":
        return "boolean"
    if kind == "array":
        return f"{ts_type(prop['items'], defs)}[]"
    if kind == "object":
        extra = prop.get("additionalProperties")
        if isinstance(extra, dict) and "$ref" in extra:
            return f"Record<string, {ref_name(str(extra['$ref']))}>"
        if isinstance(extra, dict) and extra.get("type") == "string":
            return "Record<string, string>"
        if prop.get("properties") and set(prop["properties"]) <= {"width", "height"}:
            return "Record<string, string | number>"
        return "Record<string, unknown>"
    return "unknown"


def ordered_props(defs: dict[str, Any], name: str) -> list[tuple[str, dict[str, Any], bool]]:
    definition = defs[name]
    required = set(definition.get("required", []))
    props = definition.get("properties", {})
    required_items = [(key, value, True) for key, value in props.items() if key in required]
    optional_items = [(key, value, False) for key, value in props.items() if key not in required]
    return required_items + optional_items


def default_for(py: str) -> str | None:
    if py.startswith("Mapping["):
        return "field(default_factory=dict)"
    return "None"


def gen_python(schema: dict[str, Any]) -> str:
    defs = schema["$defs"]
    meta = schema["x-omora"]
    lines = [PY_HEADER]
    lines.extend(
        [
            f"SCHEMA = {json.dumps(schema['$defs']['document']['properties']['schema']['const'])}",
            f"ID_PATTERN = {json.dumps(defs['id']['pattern'])}",
            f"CHAIN_PATTERN = {json.dumps(defs['chain']['pattern'])}",
            f"ID_FIELD = {json.dumps(meta['idField'])}",
            f"CHAIN_FIELD = {json.dumps(meta['chainField'])}",
            f"ORDER_FIELD = {json.dumps(meta['orderField'])}",
            f"LAYOUT_FIELD = {json.dumps(meta['layoutField'])}",
            "NON_NESTING_FIELDS = (",
            *[f"    {json.dumps(name)}," for name in meta["nonNestingFields"]],
            ")",
            f"ROOT_KIND = {json.dumps(meta['rootKind'])}",
            "MOUNT_MODES = (",
            *[f"    {json.dumps(mode)}," for mode in meta["mountModes"]],
            ")",
            "",
            "",
        ]
    )
    for name in ("Placement", "Node", "Page", "LedgerEntry", "Mount", "Document", "Partial"):
        def_key = name.lower() if name != "LedgerEntry" else "ledgerEntry"
        lines.append("@dataclass(frozen=True)")
        lines.append(f"class {name}:")
        fields = ordered_props(defs, def_key)
        if not fields:
            lines.append("    pass")
        for key, prop, required in fields:
            py = py_type(prop, defs)
            if required:
                lines.append(f"    {key}: {py}")
            else:
                default = default_for(py)
                if py.startswith("Mapping["):
                    lines.append(f"    {key}: {py} = {default}")
                else:
                    lines.append(f"    {key}: {py} | None = {default}")
        lines.extend(["", ""])
    lines.append("__all__ = [")
    all_names = (
        "SCHEMA",
        "ID_PATTERN",
        "CHAIN_PATTERN",
        "ID_FIELD",
        "CHAIN_FIELD",
        "ORDER_FIELD",
        "LAYOUT_FIELD",
        "NON_NESTING_FIELDS",
        "ROOT_KIND",
        "MOUNT_MODES",
        "Placement",
        "Node",
        "Page",
        "LedgerEntry",
        "Mount",
        "Document",
        "Partial",
    )
    lines.extend(
        f"    {json.dumps(name)},"
        for name in sorted(all_names, key=lambda name: (not name.isupper(), name))
    )
    lines.append("]")
    lines.append("")
    return "\n".join(lines)


def gen_ts(schema: dict[str, Any]) -> str:
    defs = schema["$defs"]
    meta = schema["x-omora"]
    lines = [TS_HEADER]
    for name in ("Placement", "Node", "Page", "LedgerEntry", "Mount", "Document", "Partial"):
        def_key = name.lower() if name != "LedgerEntry" else "ledgerEntry"
        lines.append(f"export interface {name} {{")
        for key, prop, required in ordered_props(defs, def_key):
            ts = ts_type(prop, defs)
            mark = "" if required else "?"
            lines.append(f"  {key}{mark}: {ts};")
        lines.append("}")
        lines.append("")
    schema_text = json.dumps(schema, ensure_ascii=False, separators=(",", ":"))
    lines.append("export const TREE_SCHEMA = JSON.parse(")
    lines.append(f"  String.raw`{schema_text}`,")
    lines.append(") as unknown;")
    lines.append("")
    lines.append(f"export const TREE_SCHEMA_ID = {json.dumps(schema['$id'])};")
    lines.append(f"export const TREE_ID_PATTERN = {json.dumps(defs['id']['pattern'])};")
    lines.append(f"export const TREE_ID_FIELD = {json.dumps(meta['idField'])};")
    lines.append(f"export const TREE_CHAIN_FIELD = {json.dumps(meta['chainField'])};")
    lines.append(f"export const TREE_ORDER_FIELD = {json.dumps(meta['orderField'])};")
    lines.append(f"export const TREE_LAYOUT_FIELD = {json.dumps(meta['layoutField'])};")
    lines.append(
        "export const TREE_NON_NESTING_FIELDS = ["
        + ", ".join(json.dumps(name) for name in meta["nonNestingFields"])
        + "] as const;"
    )
    lines.append(f"export const TREE_ROOT_KIND = {json.dumps(meta['rootKind'])};")
    lines.append(
        "export const TREE_MOUNT_MODES = ["
        + ", ".join(json.dumps(mode) for mode in meta["mountModes"])
        + "] as const;"
    )
    lines.append("")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate tree contract files")
    parser.add_argument("--check", action="store_true", help="只检查生成物是否最新")
    args = parser.parse_args(argv)
    schema = load_schema()
    targets = {
        PY_OUT: gen_python(schema),
        TS_OUT: gen_ts(schema),
    }
    if args.check:
        problems = []
        for path, text in targets.items():
            actual = path.read_text(encoding="utf-8") if path.exists() else None
            if actual != text:
                problems.append(path.relative_to(ROOT))
        if problems:
            print("FAIL tree.schema")
            for path in problems:
                print(f"  {path} 不是最新；跑 uv run python scripts/tree_schema.py")
            return 1
        print("PASS tree.schema")
        return 0
    for path, text in targets.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8", newline="\n")
    print(f"WROTE {len(targets)} files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
