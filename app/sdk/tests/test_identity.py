import json
from pathlib import Path

from omora.sdk.identity import chain_addr, node_identity, short_code

FIXTURE = Path(__file__).parent / "fixtures" / "identity.json"


def _fixture() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_short_code_matches_golden_fixture() -> None:
    for case in _fixture()["codes"]:
        assert short_code(case["seed"]) == case["code"]


def test_short_code_is_sixteen_chars_and_stable() -> None:
    code = short_code("page.ideas.content.main.feed[42]")
    assert len(code) == 16
    assert code == short_code("page.ideas.content.main.feed[42]")


def test_chain_addr_matches_golden_fixture() -> None:
    for case in _fixture()["addresses"]:
        assert chain_addr(case["parent"], case["code"]) == case["addr"]


def test_content_change_does_not_change_code_or_addr() -> None:
    before = node_identity("zgufckla2amnbrel", "page.ideas")
    after = node_identity("zgufckla2amnbrel", "page.ideas")
    assert before == after


def test_sibling_insert_does_not_change_existing_code() -> None:
    first = short_code("page.ideas.content.main.feed[42]")
    short_code("page.ideas.content.main.feed[41]")
    assert short_code("page.ideas.content.main.feed[42]") == first


def test_move_keeps_code_and_changes_addr() -> None:
    code = short_code("page.ideas.content.main.feed[42]")
    old = chain_addr("feed-parent", code)
    new = chain_addr("rail-parent", code)
    assert short_code("page.ideas.content.main.feed[42]") == code
    assert old != new


def test_empty_seed_is_rejected() -> None:
    try:
        short_code("")
    except ValueError as error:
        assert "seed" in str(error)
    else:
        raise AssertionError("空种子必须被拒绝")
