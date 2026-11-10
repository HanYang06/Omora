import configparser
import tomllib
from importlib.metadata import entry_points
from pathlib import Path
from typing import Any

from main import SYSTEM_PLUGINS

APP = Path(__file__).resolve().parents[2]
PACKAGES = APP / "packages"
CONFIG = APP.parent / "config.ini"
VERSION = (APP.parent / "VERSION").read_text(encoding="utf-8").strip()


def _packages() -> dict[str, dict[str, Any]]:
    found: dict[str, dict[str, Any]] = {}
    for package in sorted(PACKAGES.iterdir()):
        if not package.is_dir():
            continue
        path = package / "pyproject.toml"
        assert path.is_file(), f"{package.name} 缺少 pyproject.toml"
        data: dict[str, Any] = tomllib.loads(path.read_text(encoding="utf-8"))
        found[package.name] = data
    return found


def test_every_plugin_package_declares_itself() -> None:
    packages = _packages()

    assert packages
    for name, data in packages.items():
        project = data["project"]
        assert project["name"] == f"omora-plugin-{name}"
        assert str(project["description"]).strip()
        assert project["version"] == VERSION
        source = PACKAGES / name / "omora" / f"{name}.py"
        assert source.is_file()


def test_the_manifest_matches_the_packages_and_entry_points() -> None:
    packages = _packages()
    installed = {entry.name: entry for entry in entry_points(group="omora.plugins")}

    assert set(SYSTEM_PLUGINS) == set(packages)
    assert set(SYSTEM_PLUGINS) == set(installed)
    for name in SYSTEM_PLUGINS:
        factory = installed[name].load()
        assert factory.name == name
        assert installed[name].value.startswith(f"omora.{name}:")


def test_every_plugin_package_declares_tool_omora() -> None:
    for name, data in _packages().items():
        section = data.get("tool", {}).get("omora")
        assert isinstance(section, dict), f"{name} 缺 [tool.omora]"
        for key in ("platforms", "capabilities", "requires"):
            value = section.get(key, [])
            assert isinstance(value, list), f"{name}: tool.omora.{key} 必须是列表"
            assert all(isinstance(item, str) for item in value)
        assert isinstance(section.get("listed", True), bool)


def test_the_config_has_a_section_for_every_plugin() -> None:
    parser = configparser.ConfigParser(interpolation=None)
    parser.read_string(CONFIG.read_text(encoding="utf-8"), source=str(CONFIG))

    assert set(parser.sections()) == set(SYSTEM_PLUGINS)
