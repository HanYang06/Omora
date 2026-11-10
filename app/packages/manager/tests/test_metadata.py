"""元数据：默认值、校验、以及真的从每个 package 的 pyproject 读出来。"""

from pathlib import Path

import pytest

from main import SYSTEM_PLUGINS
from omora._metadata import InstalledCatalog, Metadata, MetadataError, parse_metadata

ROOT = Path(__file__).resolve().parents[4]


def test_a_missing_table_means_every_default() -> None:
    assert parse_metadata(None) == Metadata()
    assert parse_metadata({}) == Metadata(platforms=(), capabilities=(), listed=True, requires=())


def test_all_four_keys_are_read() -> None:
    metadata = parse_metadata(
        {
            "platforms": ["win32", "linux"],
            "capabilities": ["microphone", "camera"],
            "listed": False,
            "requires": ["store", "ui"],
        }
    )

    assert metadata == Metadata(
        platforms=("win32", "linux"),
        capabilities=("microphone", "camera"),
        listed=False,
        requires=("store", "ui"),
    )


def test_declared_order_is_kept_and_duplicates_are_dropped() -> None:
    metadata = parse_metadata({"capabilities": ["camera", "camera", "microphone"]})

    assert metadata.capabilities == ("camera", "microphone")


def test_unknown_keys_are_ignored_so_a_future_field_does_not_break_boot() -> None:
    metadata = parse_metadata({"platforms": ["win32"], "future": 1})

    assert metadata.platforms == ("win32",)


@pytest.mark.parametrize(
    "raw",
    [
        {"platforms": "win32"},
        {"capabilities": [1]},
        {"requires": [""]},
        {"listed": "yes"},
        [],
    ],
)
def test_wrong_shapes_are_metadata_errors(raw: object) -> None:
    with pytest.raises(MetadataError):
        parse_metadata(raw)


def test_the_installed_catalog_reads_every_system_package() -> None:
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    catalog = InstalledCatalog()

    records = {name: catalog.record(name) for name in SYSTEM_PLUGINS}

    for name, record in records.items():
        assert record is not None, f"{name} 没有入口点或 pyproject"
        assert record.version == version, f"{name} 的版本没同步"
        assert record.description.strip(), f"{name} 缺 description"
        assert isinstance(record.metadata.listed, bool)
        assert record.metadata == parse_metadata(
            {
                "platforms": list(record.metadata.platforms),
                "capabilities": list(record.metadata.capabilities),
                "listed": record.metadata.listed,
                "requires": list(record.metadata.requires),
            }
        )
    manager_record = records["manager"]
    ideas_record = records["ideas"]
    assert manager_record is not None and ideas_record is not None
    assert manager_record.metadata.requires == ("store",)
    assert ideas_record.metadata.requires == ("store", "media", "ui")
