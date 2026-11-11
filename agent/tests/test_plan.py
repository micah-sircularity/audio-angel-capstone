from audio_angel.models import LineFlag, Transcript
from audio_angel.plan import (
    LINE_PAD_MS,
    WORD_PAD_MS_MUSIC,
    WORD_PAD_MS_SPEECH,
    flags_to_intervals,
)
from tests.conftest import make_segment


def transcript_with(segments, kind="music", duration_ms=100_000):
    return Transcript(
        source_key="t", kind=kind, duration_ms=duration_ms, segments=segments
    )


def flag(line, words, rule="profanity"):
    return LineFlag(
        line_index=line,
        rule_id=rule,
        words=words,
        confidence=0.9,
        reason="r",
    )


def test_word_maps_to_timestamps_with_music_pad():
    seg = make_segment(0, "what a damn day", 1000, step_ms=500)
    t = transcript_with([seg])
    plan = flags_to_intervals([flag(0, ["damn"])], t)
    assert len(plan.intervals) == 1
    assert plan.fallbacks == 0
    iv = plan.intervals[0]
    damn = seg.words[2]
    assert iv.start_ms == damn.start_ms - WORD_PAD_MS_MUSIC
    assert iv.end_ms == damn.end_ms + WORD_PAD_MS_MUSIC
    assert iv.rule_ids == ["profanity"]


def test_speech_pad_is_smaller():
    seg = make_segment(0, "a damn day", 1000)
    t = transcript_with([seg], kind="podcast")
    iv = flags_to_intervals([flag(0, ["damn"])], t).intervals[0]
    assert iv.start_ms == seg.words[1].start_ms - WORD_PAD_MS_SPEECH


def test_repeated_words_consumed_in_order():
    # 2s between words so the padded intervals don't merge
    seg = make_segment(0, "damn damn damn", 1000, step_ms=2000)
    t = transcript_with([seg])
    plan = flags_to_intervals([flag(0, ["damn", "damn", "damn"])], t)
    # all three occurrences consumed, sequential
    assert len(plan.intervals) == 3
    intervals = plan.intervals
    starts = [iv.start_ms for iv in intervals]
    assert starts == sorted(starts)
    # each maps to a different word timestamp
    assert intervals[0].start_ms == seg.words[0].start_ms - WORD_PAD_MS_MUSIC
    assert intervals[2].start_ms == seg.words[2].start_ms - WORD_PAD_MS_MUSIC


def test_empty_words_mutes_whole_line():
    seg = make_segment(0, "controversial topic talk", 2000)
    t = transcript_with([seg])
    iv = flags_to_intervals([flag(0, [], rule="topic:x")], t).intervals[0]
    assert iv.start_ms == seg.start_ms - LINE_PAD_MS
    assert iv.end_ms == seg.end_ms + LINE_PAD_MS


def test_multiword_entry_span():
    seg = make_segment(0, "son of a bitch yes", 1000)
    t = transcript_with([seg])
    iv = flags_to_intervals([flag(0, ["son of a"])], t).intervals[0]
    assert iv.start_ms == seg.words[0].start_ms - WORD_PAD_MS_MUSIC
    assert iv.end_ms == seg.words[2].end_ms + WORD_PAD_MS_MUSIC


def test_clamp_and_merge():
    seg = make_segment(0, "damn day damn", 0, step_ms=200)
    t = transcript_with([seg], duration_ms=900)
    ivs = flags_to_intervals([flag(0, ["damn", "damn"])], t).intervals
    # first clamps at 0, second at duration; gap between padded
    # intervals is small so they merge into one [0, duration]
    assert len(ivs) == 1
    assert ivs[0].start_ms == 0
    assert ivs[0].end_ms == 900


def test_merge_unions_rule_ids():
    seg = make_segment(0, "damn hell", 0, step_ms=100)
    t = transcript_with([seg], duration_ms=5000)
    ivs = flags_to_intervals(
        [flag(0, ["damn"], rule="profanity"), flag(0, ["hell"], rule="term:hell")],
        t,
    ).intervals
    assert len(ivs) == 1
    assert sorted(ivs[0].rule_ids) == ["profanity", "term:hell"]


def test_unmatched_word_falls_back_to_whole_line():
    seg = make_segment(0, "a nice day", 0)
    t = transcript_with([seg])
    plan = flags_to_intervals([flag(0, ["zebra"])], t)
    # Never dropped: the whole segment is muted instead.
    assert plan.fallbacks == 1
    assert len(plan.intervals) == 1
    assert plan.intervals[0].start_ms == max(0, seg.start_ms - LINE_PAD_MS)
    assert plan.intervals[0].end_ms == seg.end_ms + LINE_PAD_MS
