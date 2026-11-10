"""纯文字：时间、片段、捕捉标题。这些函数不碰 store，也不碰页面状态。"""

from datetime import datetime, timedelta

from omora._format import caption, peaks, snippet, when


def test_snippets_cut_a_window_around_the_match() -> None:
    title = "开头" * 20 + "牛奶" + "结尾" * 20

    cut = snippet(title, "牛奶")

    assert "牛奶" in cut
    assert len(cut) <= 42
    assert cut.startswith("…")
    assert cut.endswith("…")
    assert snippet("买牛奶", "牛奶") == "买牛奶"
    assert snippet("写周报", "牛奶") == "写周报"
    assert snippet("很短" * 30, "牛奶") == ("很短" * 30)[:40] + "…"


def test_relative_time_reads_like_a_ledger() -> None:
    now = datetime(2026, 11, 9, 12, 0)

    assert when(now - timedelta(seconds=20), now) == "刚刚"
    assert when(now - timedelta(minutes=5), now) == "5 分钟前"
    assert when(now - timedelta(hours=3), now) == "3 小时前"
    assert when(now - timedelta(days=1), now) == "昨天"
    assert when(now - timedelta(days=3), now) == "周五"
    assert when(now - timedelta(days=20), now) == "10 月 20 日"


def test_a_capture_s_default_name_is_the_moment_it_was_saved() -> None:
    saved_at = datetime(2026, 11, 11, 3, 41)

    assert caption(saved_at, "语音") == "语音 11-11 03:41"
    assert caption(saved_at, "视频") == "视频 11-11 03:41"
    assert caption(datetime(2027, 1, 2, 23, 5), "语音") == "语音 01-02 23:05"


def test_waveform_peaks_are_kept_inside_the_contract() -> None:
    assert peaks({"peaks": [0, 40, 100]}) == (0, 40, 100)
    assert peaks({}) == ()
    assert peaks({"peaks": [-4, 40, 140]}) == (0, 40, 100)
    assert len(peaks({"peaks": list(range(400))})) == 300
