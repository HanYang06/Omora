from pathlib import Path

import pytest

from boot import load_config


def _write(tmp_path: Path, name: str, text: str) -> Path:
    path = tmp_path / name
    path.write_text(text, encoding="utf-8")
    return path


def test_system_config_alone_is_read(tmp_path: Path) -> None:
    system = _write(tmp_path, "config.ini", "[net]\nhost = 127.0.0.1\nport = 8765\n")

    config = load_config(system)

    assert config.for_plugin("net") == {"host": "127.0.0.1", "port": "8765"}


def test_user_config_overrides_one_key_and_keeps_the_rest(tmp_path: Path) -> None:
    system = _write(tmp_path, "config.ini", "[net]\nhost = 127.0.0.1\nport = 8765\n")
    user = _write(tmp_path, "config.yaml", "net:\n  port: 9000\n")

    config = load_config(system, user)

    assert config.for_plugin("net") == {"host": "127.0.0.1", "port": 9000}


def test_a_section_no_plugin_claims_is_reported(tmp_path: Path) -> None:
    system = _write(tmp_path, "config.ini", "[net]\nport = 8765\n\n[stroe]\nenabled = true\n")

    config = load_config(system)
    config.for_plugin("net")

    assert config.unclaimed() == ["stroe"]


def test_enabled_is_false_when_config_says_so_and_is_not_passed_on(tmp_path: Path) -> None:
    system = _write(tmp_path, "config.ini", "[net]\nenabled = false\nport = 8765\n")

    config = load_config(system)

    assert config.enabled("net") is False
    assert config.for_plugin("net") == {"port": "8765"}


def test_missing_system_config_is_an_error(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError, match="缺少系统配置"):
        load_config(tmp_path / "nope.ini")
