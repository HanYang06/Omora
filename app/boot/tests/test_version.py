import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def _versions() -> dict[str, str]:
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    pyproject = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    match = re.search(r'^version = "([^"]+)"$', pyproject, re.MULTILINE)
    assert match is not None, "pyproject.toml 里没有 version"

    found = {"VERSION": version, "pyproject.toml": match.group(1)}
    for relative in ("package.json", "app/ui-engine/package.json"):
        path = ROOT / relative
        if path.exists():
            found[relative] = json.loads(path.read_text(encoding="utf-8"))["version"]
    return found


def test_every_package_metadata_carries_the_software_version() -> None:
    found = _versions()

    assert set(found.values()) == {found["VERSION"]}, found
