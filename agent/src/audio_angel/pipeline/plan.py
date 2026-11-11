"""Flags -> mute intervals. Ports the semantics of
packages/filters/src/audio-plan.ts: word flags map to word timestamps
inside their segment (each listed word consumed once, in order), pads
depend on content kind, empty words mute the whole line, intervals
clamp to [0, duration] and merge across gaps <= 150 ms.

A flag is never dropped: when any of its listed words can't be located
in the segment's word timestamps, the whole segment is muted instead
and the miss is counted in PlanResult.fallbacks.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from audio_angel.models import LineFlag, MuteInterval, Segment, Transcript

WORD_PAD_MS_MUSIC = 150
WORD_PAD_MS_SPEECH = 80
LINE_PAD_MS = 120
# Vocal-stem transcripts use the old Convex lane's tighter asymmetric
# pads: −40 ms before the word, +70 ms after.
VOCALS_PAD_BEFORE_MS = 40
VOCALS_PAD_AFTER_MS = 70
MUTE_MERGE_GAP_MS = 150


@dataclass
class PlanResult:
    """Merged mute intervals plus how many flags fell back to whole-line."""

    intervals: list[MuteInterval]
    fallbacks: int


def _normalize(text: str) -> str:
    return (
        unicodedata.normalize("NFKC", text)
        .lower()
        .replace("\u2019", "")
        .replace("'", "")
    )


def _tokens(text: str) -> list[str]:
    return re.findall(r"[^\W_]+", _normalize(text))


def _find_word_span(
    segment: Segment, entry: str, start_at: int
) -> tuple[int, int, int] | None:
    """Locate entry (1+ tokens) in segment.words at index >= start_at.

    Returns (first_word_index, last_word_index, next_cursor) or None.
    """
    needed = _tokens(entry)
    if not needed:
        return None
    words = segment.words
    n = len(needed)
    for i in range(start_at, len(words) - n + 1):
        actual = _tokens(" ".join(w.text for w in words[i : i + n]))
        if len(actual) == n and all(
            actual[j] == needed[j]
            or (j == n - 1 and actual[j] in (needed[j] + "s", needed[j] + "es"))
            for j in range(n)
        ):
            return i, i + n - 1, i + n
    return None


def _line_interval(segment: Segment, rule_id: str) -> MuteInterval:
    return MuteInterval(
        start_ms=segment.start_ms - LINE_PAD_MS,
        end_ms=segment.end_ms + LINE_PAD_MS,
        rule_ids=[rule_id],
    )


def flags_to_intervals(flags: list[LineFlag], transcript: Transcript) -> PlanResult:
    """Convert validated flags to clamped, merged mute intervals.

    Never drops a flag: a flag whose words are all located maps to word
    intervals; otherwise the whole segment is muted and the flag counts
    as one fallback.
    """
    pad = WORD_PAD_MS_MUSIC if transcript.kind == "music" else WORD_PAD_MS_SPEECH
    pad_before = pad_after = pad
    if transcript.audio_source == "vocals":
        pad_before, pad_after = VOCALS_PAD_BEFORE_MS, VOCALS_PAD_AFTER_MS
    by_index = {s.index: s for s in transcript.segments}
    raw: list[MuteInterval] = []
    fallbacks = 0
    for flag in flags:
        segment = by_index.get(flag.line_index)
        if segment is None:
            raw.append(MuteInterval(start_ms=0, end_ms=0, rule_ids=[flag.rule_id]))
            continue
        if not flag.words:
            raw.append(_line_interval(segment, flag.rule_id))
            continue
        spans: list[MuteInterval] = []
        cursor = 0
        missed = False
        for entry in flag.words:
            found = _find_word_span(segment, entry, cursor)
            if found is None:
                # Retry from the top: a later-listed word may precede an
                # earlier one in the line.
                found = _find_word_span(segment, entry, 0)
            if found is None:
                missed = True
                break
            first, last, cursor = found
            spans.append(
                MuteInterval(
                    start_ms=segment.words[first].start_ms - pad_before,
                    end_ms=segment.words[last].end_ms + pad_after,
                    rule_ids=[flag.rule_id],
                )
            )
        if missed:
            fallbacks += 1
            raw.append(_line_interval(segment, flag.rule_id))
        else:
            raw.extend(spans)
    # Clamp first, then drop anything clamped to empty.
    clamped = [
        MuteInterval(
            start_ms=max(0, item.start_ms),
            end_ms=min(transcript.duration_ms, item.end_ms),
            rule_ids=item.rule_ids,
        )
        for item in raw
    ]
    clamped = [item for item in clamped if item.end_ms > item.start_ms]
    merged: list[MuteInterval] = []
    for item in sorted(clamped, key=lambda i: i.start_ms):
        last = merged[-1] if merged else None
        if last is not None and item.start_ms - last.end_ms <= MUTE_MERGE_GAP_MS:
            last.end_ms = max(last.end_ms, item.end_ms)
            last.rule_ids = sorted(set(last.rule_ids) | set(item.rule_ids))
        else:
            merged.append(MuteInterval(**item.model_dump()))
    return PlanResult(intervals=merged, fallbacks=fallbacks)
