import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PACKAGES = ROOT / "packages"

PYPROJECTS = [
    ROOT / "pyproject.toml",
    ROOT / "app" / "core" / "pyproject.toml",
    ROOT / "app" / "sdk" / "pyproject.toml",
    *sorted(PACKAGES.glob("*/pyproject.toml")),
]


def _versions() -> dict[str, str]:
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    found = {"VERSION": version}

    for path in PYPROJECTS:
        text = path.read_text(encoding="utf-8")
        match = re.search(r'^version = "([^"]+)"$', text, re.MULTILINE)
        assert match is not None, f"{path.relative_to(ROOT)} 里没有 version"
        found[path.relative_to(ROOT).as_posix()] = match.group(1)

    for relative in ("package.json", "app/ui-engine/package.json"):
        path = ROOT / relative
        if path.exists():
            found[relative] = json.loads(path.read_text(encoding="utf-8"))["version"]
    return found


def test_every_package_metadata_carries_the_software_version() -> None:
    found = _versions()

    assert set(found.values()) == {found["VERSION"]}, found
