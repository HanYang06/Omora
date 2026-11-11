"""键索引生成器：扫得对、查得出、产物稳定。"""

from __future__ import annotations

from pathlib import Path

import keys
import pytest

ROOT = Path(__file__).resolve().parents[2]


def _tree(tmp_path: Path, files: dict[str, str]) -> Path:
    for relative, source in files.items():
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source, encoding="utf-8")
    (tmp_path / "app" / "packages").mkdir(parents=True, exist_ok=True)
    return tmp_path


def test_declarations_and_uses_are_collected(tmp_path: Path) -> None:
    root = _tree(
        tmp_path,
        {
            "app/packages/demo/omora/demo.py": (
                'slot = Slot(key="demo.slot")\nui.contribute(ctx, "demo.slot", self.build)\n'
            )
        },
    )

    entries = keys.scan(root)

    entry = entries["demo.slot"]
    assert entry.declared_by == "demo"
    assert entry.declarations[0].path == "app/packages/demo/omora/demo.py"
    assert entry.declarations[0].line == 1
    assert entry.uses[0].line == 2
    assert entry.uses[0].owner == "demo"


def test_the_window_key_is_builtin(tmp_path: Path) -> None:
    root = _tree(tmp_path, {})

    entries = keys.scan(root)

    assert entries["om.window.page"].declared_by == "ui"
    assert entries["om.window.page"].declarations == ()


def test_duplicate_declarations_are_rejected(tmp_path: Path) -> None:
    source = 'x = Slot(key="demo.slot")\n'
    root = _tree(
        tmp_path,
        {
            "app/packages/demo/omora/a.py": source,
            "app/packages/other/omora/b.py": source,
        },
    )

    with pytest.raises(keys.KeysError, match="重复声明"):
        keys.scan(root)


def test_a_bad_key_is_rejected(tmp_path: Path) -> None:
    root = _tree(tmp_path, {"app/packages/demo/omora/a.py": 'x = Slot(key="Demo")\n'})

    with pytest.raises(keys.KeysError, match="不合格"):
        keys.scan(root)


def test_tests_are_not_scanned(tmp_path: Path) -> None:
    root = _tree(
        tmp_path,
        {"app/packages/demo/tests/test_demo.py": 'x = Slot(key="demo.slot")\n'},
    )

    assert "demo.slot" not in keys.scan(root)


def test_rendered_artifacts_are_sorted(tmp_path: Path) -> None:
    root = _tree(
        tmp_path,
        {
            "app/packages/demo/omora/a.py": (
                'a = Slot(key="demo.beta")\nb = Slot(key="demo.alpha")\n'
            )
        },
    )

    rendered = keys.render(keys.scan(root))

    python_source = rendered[keys.PYTHON_OUT]
    assert python_source.index('"demo.alpha"') < python_source.index('"demo.beta"')
    assert 'DEMO_ALPHA: str = "demo.alpha"' in python_source
    ts_source = rendered[keys.TS_OUT]
    assert ts_source.index('"demo.alpha"') < ts_source.index('"demo.beta"')
    index_source = rendered[keys.INDEX_OUT]
    assert index_source.index('"demo.alpha"') < index_source.index('"demo.beta"')
