"""Deepgram pre-recorded transcription via REST.

Posts the audio bytes directly (Content-Type: audio/mpeg). The response
segmenting is an exact port of convex/lib/deepgram.ts: utterances ->
segments, ~8s punctuation-aware fallback, a 45s hard cap re-split, and
retry/backoff on 429/5xx. Results are cached as JSON.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from pathlib import Path

import httpx
import logfire

from audio_angel.helpers.paths import cache_dir, safe_key
from audio_angel.models import Segment, Transcript, Word

LISTEN_URL = (
    "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&utterances=true"
)
TIMEOUT_S = 240.0
MAX_ATTEMPTS = 3
BACKOFF_S = [1.0, 2.0, 4.0]
FALLBACK_SEGMENT_MS = 8_000
MAX_SEGMENT_MS = 45_000


class DeepgramError(Exception):
    def __init__(self, code: str, message: str, status: int | None = None):
        super().__init__(message)
        self.code = code
        self.status = status


def _record(value: object) -> dict | None:
    return value if isinstance(value, dict) else None


def _to_ms(seconds: object) -> int:
    return round(seconds * 1000) if isinstance(seconds, (int, float)) else 0


def _map_word(raw: object) -> Word | None:
    word = _record(raw)
    if not word:
        return None
    text = word.get("punctuated_word") or word.get("word")
    if not isinstance(text, str) or not text:
        return None
    return Word(
        start_ms=_to_ms(word.get("start")), end_ms=_to_ms(word.get("end")), text=text
    )


def _channel_words(body: dict) -> list[Word]:
    results = _record(body.get("results")) or {}
    channels = results.get("channels")
    channel = _record(channels[0]) if isinstance(channels, list) and channels else None
    alternatives = (channel or {}).get("alternatives")
    alternative = (
        _record(alternatives[0])
        if isinstance(alternatives, list) and alternatives
        else None
    )
    words = (alternative or {}).get("words")
    items = words if isinstance(words, list) else []
    return [w for w in (_map_word(item) for item in items) if w is not None]


_PUNCT_END = re.compile(r"[.!?][\"')\]]*$")


def _ends_with_punctuation(word: Word) -> bool:
    return bool(_PUNCT_END.search(word.text))


def _segment_from_words(words: list[Word]) -> Segment:
    return Segment(
        index=-1,
        start_ms=words[0].start_ms,
        end_ms=words[-1].end_ms,
        text=" ".join(w.text for w in words),
        words=words,
    )


def group_words_into_segments(words: list[Word]) -> list[Segment]:
    """Group flat word timing into ~8s segments that break at punctuation."""
    segments: list[Segment] = []
    current: list[Word] = []
    for word in words:
        current.append(word)
        span_ms = word.end_ms - current[0].start_ms
        if _ends_with_punctuation(word) or span_ms >= FALLBACK_SEGMENT_MS:
            segments.append(_segment_from_words(current))
            current = []
    if current:
        segments.append(_segment_from_words(current))
    return segments


def split_long_segment(segment: Segment) -> list[Segment]:
    """Split a >45s segment into word-grouped pieces, preferring punctuation."""
    if segment.end_ms - segment.start_ms <= MAX_SEGMENT_MS:
        return [segment]
    pieces: list[Segment] = []
    current: list[Word] = []
    for word in segment.words:
        would_exceed = (
            len(current) > 0 and word.end_ms - current[0].start_ms > MAX_SEGMENT_MS
        )
        if would_exceed:
            # Back off to the last punctuation word if one sits inside.
            cut = len(current)
            for i in range(len(current) - 1, -1, -1):
                if _ends_with_punctuation(current[i]):
                    cut = i + 1
                    break
            head, tail = current[:cut], current[cut:]
            pieces.append(_segment_from_words(head))
            current = [*tail, word]
        else:
            current.append(word)
    if current:
        pieces.append(_segment_from_words(current))
    return pieces


def _utterance_segments(body: dict) -> list[Segment]:
    results = _record(body.get("results")) or {}
    utterances = results.get("utterances")
    items = utterances if isinstance(utterances, list) else []
    segments: list[Segment] = []
    for raw in items:
        utterance = _record(raw)
        if not utterance:
            continue
        raw_words = utterance.get("words")
        word_items = raw_words if isinstance(raw_words, list) else []
        words = [w for w in (_map_word(w) for w in word_items) if w is not None]
        transcript = utterance.get("transcript")
        text = (
            transcript.strip()
            if isinstance(transcript, str) and transcript.strip()
            else " ".join(w.text for w in words)
        )
        if not text:
            continue
        segments.append(
            Segment(
                index=-1,
                start_ms=_to_ms(utterance.get("start")),
                end_ms=_to_ms(utterance.get("end")),
                text=text,
                words=words,
            )
        )
    return segments


def _metadata_duration_ms(body: dict) -> int:
    metadata = _record(body.get("metadata")) or {}
    return _to_ms(metadata.get("duration"))


def parse_response(body: dict) -> tuple[int, list[Segment]]:
    """Deepgram JSON -> (duration_ms, segments) per the TS port."""
    words = _channel_words(body)
    if not words:
        raise DeepgramError(
            "no-speech", "no-speech: Deepgram returned no words for this audio"
        )
    utterances = _utterance_segments(body)
    raw = utterances if utterances else group_words_into_segments(words)
    segments = [piece for segment in raw for piece in split_long_segment(segment)]
    last_end = max(s.end_ms for s in segments)
    return max(_metadata_duration_ms(body), last_end), segments


def _cache_path(source_key: str, audio_source: str = "mix") -> Path:
    suffix = ".vocals.json" if audio_source == "vocals" else ".json"
    return cache_dir("transcripts") / f"{safe_key(source_key)}{suffix}"


def load_cached_transcript(
    source_key: str, audio_source: str = "mix"
) -> Transcript | None:
    path = _cache_path(source_key, audio_source)
    if not path.exists():
        return None
    return Transcript.model_validate(json.loads(path.read_text()))


async def transcribe_audio(
    audio: bytes,
    *,
    source_key: str,
    kind: str,
    client: httpx.AsyncClient,
    api_key: str | None = None,
    audio_source: str = "mix",
    content_type: str = "audio/mpeg",
) -> Transcript:
    """Transcribe audio bytes with nova-3 + utterances + smart_format.

    Retries 429/5xx/network errors with backoff; other 4xx fail fast.
    Cached on disk keyed by source_key; "vocals" audio gets its own
    `<key>.vocals.json` cache file so stems don't collide with mixes.
    """
    cached = load_cached_transcript(source_key, audio_source)
    if cached is not None:
        return cached

    api_key = api_key or os.environ.get("DEEPGRAM_API_KEY", "").strip()
    if not api_key:
        raise DeepgramError(
            "http", "DEEPGRAM_API_KEY is not set; cannot transcribe audio"
        )

    last_error: DeepgramError | None = None
    for attempt in range(MAX_ATTEMPTS):
        if attempt > 0:
            await asyncio.sleep(BACKOFF_S[attempt - 1])
        try:
            with logfire.span("deepgram.transcribe", source_key=source_key):
                res = await client.post(
                    LISTEN_URL,
                    content=audio,
                    headers={
                        "Authorization": f"Token {api_key}",
                        "Content-Type": content_type,
                    },
                    timeout=TIMEOUT_S,
                )
        except httpx.HTTPError as exc:
            last_error = DeepgramError("http", f"Deepgram request failed: {exc}")
            continue
        if res.status_code < 400:
            body = _record(res.json())
            if body is None:
                raise DeepgramError("http", "Deepgram returned an invalid body")
            try:
                duration_ms, segments = parse_response(body)
            except DeepgramError as exc:
                if exc.code != "no-speech":
                    raise
                # Instrumental/no-vocal audio is a normal outcome, not a
                # failure: cache an empty transcript so a re-click is free.
                transcript = Transcript(
                    source_key=source_key,
                    kind=kind,  # type: ignore[arg-type]
                    duration_ms=_metadata_duration_ms(body),
                    segments=[],
                    audio_source=audio_source,  # type: ignore[arg-type]
                )
                _cache_path(source_key, audio_source).write_text(
                    transcript.model_dump_json(indent=2)
                )
                return transcript
            for index, segment in enumerate(segments):
                segment.index = index
            transcript = Transcript(
                source_key=source_key,
                kind=kind,  # type: ignore[arg-type]
                duration_ms=duration_ms,
                segments=segments,
                audio_source=audio_source,  # type: ignore[arg-type]
            )
            _cache_path(source_key, audio_source).write_text(
                transcript.model_dump_json(indent=2)
            )
            return transcript
        excerpt = res.text[:200]
        if res.status_code == 429 or res.status_code >= 500:
            last_error = DeepgramError(
                "http",
                f"Deepgram HTTP {res.status_code}: {excerpt}",
                res.status_code,
            )
            continue
        raise DeepgramError(
            "http", f"Deepgram HTTP {res.status_code}: {excerpt}", res.status_code
        )
    raise last_error or DeepgramError("http", "Deepgram request failed")
