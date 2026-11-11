import httpx
import pytest

from audio_angel.pipeline.transcribe import (
    DeepgramError,
    Word,
    group_words_into_segments,
    parse_response,
    split_long_segment,
    transcribe_audio,
)


def word(text, start_s, end_s):
    return {"word": text, "punctuated_word": text, "start": start_s, "end": end_s}


def dg_body(utterances=None, words=None, duration=10.0):
    return {
        "metadata": {"duration": duration},
        "results": {
            "channels": [{"alternatives": [{"words": words or []}]}],
            "utterances": utterances or [],
        },
    }


def test_utterances_become_segments():
    body = dg_body(
        utterances=[
            {
                "transcript": "hello world",
                "start": 0.0,
                "end": 1.0,
                "words": [word("hello", 0, 0.5), word("world", 0.5, 1.0)],
            },
            {
                "transcript": "second line",
                "start": 2.0,
                "end": 3.0,
                "words": [word("second", 2, 2.5), word("line", 2.5, 3.0)],
            },
        ],
        words=[word("hello", 0, 0.5), word("world", 0.5, 1.0)],
        duration=12.34,
    )
    duration_ms, segments = parse_response(body)
    assert duration_ms == 12340
    assert len(segments) == 2
    assert segments[0].text == "hello world"
    assert segments[0].start_ms == 0 and segments[0].end_ms == 1000


def test_fallback_groups_on_punctuation_and_span():
    words = [
        Word(text=t, start_ms=i * 2000, end_ms=i * 2000 + 900)
        for i, t in enumerate(["one", "two.", "three", "four", "five", "six", "seven"])
    ]
    segments = group_words_into_segments(words)
    # "two." ends segment 1; the remaining words flush when the 8s
    # span is exceeded (seven's end minus three's start >= 8000ms).
    assert [s.text for s in segments] == [
        "one two.",
        "three four five six seven",
    ]


def test_split_long_segment_prefers_punctuation():
    words = [
        Word(text=f"w{i}.", start_ms=i * 10000, end_ms=i * 10000 + 9000)
        for i in range(8)
    ]
    from audio_angel.models import Segment

    segment = Segment(
        index=0,
        start_ms=0,
        end_ms=79_000,
        text=" ".join(w.text for w in words),
        words=words,
    )
    pieces = split_long_segment(segment)
    assert len(pieces) >= 2
    assert all(p.end_ms - p.start_ms <= 45_000 + 9000 for p in pieces)
    # every word preserved in order
    flat = [w.text for p in pieces for w in p.words]
    assert flat == [w.text for w in words]


def test_no_speech_error():
    body = dg_body(words=[], utterances=[])
    with pytest.raises(DeepgramError, match="no-speech"):
        parse_response(body)


def _good_response():
    return httpx.Response(
        200,
        json=dg_body(
            utterances=[
                {
                    "transcript": "hi there",
                    "start": 0,
                    "end": 1,
                    "words": [word("hi", 0, 0.4), word("there", 0.5, 1.0)],
                }
            ],
            words=[word("hi", 0, 0.4)],
        ),
    )


async def test_transcribe_posts_bytes_and_caches(monkeypatch):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        assert request.headers["authorization"] == "Token dg-key"
        assert request.headers["content-type"] == "audio/mpeg"
        assert request.content == b"audio-bytes"
        return _good_response()

    monkeypatch.setenv("DEEPGRAM_API_KEY", "dg-key")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        t1 = await transcribe_audio(
            b"audio-bytes", source_key="aud:x1", kind="music", client=client
        )
        t2 = await transcribe_audio(
            b"audio-bytes", source_key="aud:x1", kind="music", client=client
        )
    assert len(calls) == 1  # second call hit the cache
    assert t1 == t2
    assert t1.segments[0].index == 0
    assert t1.source_key == "aud:x1"
    assert t1.kind == "music"


async def test_transcribe_retries_5xx_then_succeeds(monkeypatch):
    calls = []

    def handler(request):
        calls.append(1)
        if len(calls) == 1:
            return httpx.Response(503, text="down")
        return _good_response()

    monkeypatch.setenv("DEEPGRAM_API_KEY", "dg-key")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        transcript = await transcribe_audio(
            b"a", source_key="aud:x2", kind="music", client=client
        )
    assert len(calls) == 2
    assert transcript.segments


async def test_transcribe_4xx_fails_fast(monkeypatch):
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(401, text="bad key")

    monkeypatch.setenv("DEEPGRAM_API_KEY", "dg-key")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(DeepgramError, match="HTTP 401"):
            await transcribe_audio(
                b"a", source_key="aud:x3", kind="music", client=client
            )
    assert len(calls) == 1


async def test_missing_api_key_fails(monkeypatch):
    monkeypatch.delenv("DEEPGRAM_API_KEY", raising=False)
    async with httpx.AsyncClient() as client:
        with pytest.raises(DeepgramError, match="DEEPGRAM_API_KEY"):
            await transcribe_audio(
                b"a", source_key="aud:x4", kind="music", client=client
            )


async def test_no_speech_caches_empty_transcript(monkeypatch):
    """no-speech returns a cached empty transcript — no second call."""
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=dg_body(words=[], utterances=[]))

    monkeypatch.setenv("DEEPGRAM_API_KEY", "dg-key")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        t1 = await transcribe_audio(
            b"a", source_key="aud:instr", kind="music", client=client
        )
        t2 = await transcribe_audio(
            b"a", source_key="aud:instr", kind="music", client=client
        )
    assert t1.segments == []
    assert t1 == t2
    assert len(calls) == 1  # cached: no second Deepgram call
