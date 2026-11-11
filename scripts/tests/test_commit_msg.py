from commit_msg import validate


def test_a_typed_header_passes() -> None:
    assert validate("feat(core): 增加事件日志") == []


def test_an_empty_message_is_rejected() -> None:
    assert validate("   ") == ["提交信息为空"]


def test_a_generic_subject_is_rejected() -> None:
    errors = validate("chore: update")

    assert any("太笼统" in error for error in errors)


def test_an_unknown_type_is_rejected() -> None:
    errors = validate("hotfix: 紧急修复")

    assert any("未知类型" in error for error in errors)


def test_git_mechanism_headers_are_exempt() -> None:
    for header in (
        "Merge branch 'main'",
        'Revert "feat(core): 增加事件日志"',
        "fixup! feat(core): 增加事件日志",
        "squash! feat(core): 增加事件日志",
        "amend! feat(core): 增加事件日志",
    ):
        assert validate(header) == []


def test_the_commit_format_trailer_exempts_a_special_message() -> None:
    text = "v0.2.0 发布快照\n\nCommit-Format: exempt（一次性迁移）\n"

    assert validate(text) == []


def test_the_trailer_is_case_insensitive() -> None:
    text = "随便写的一次性提交\n\ncommit-format: EXEMPT\n"

    assert validate(text) == []


def test_a_long_subject_is_rejected() -> None:
    errors = validate("feat: " + "长" * 60)

    assert any("subject 长度" in error for error in errors)


def test_a_long_body_line_is_rejected() -> None:
    errors = validate("feat(core): 增加事件\n\n" + "x" * 80)

    assert any("超过 72" in error for error in errors)
