from __future__ import annotations

import hashlib

import numpy as np
import pydantic_ai.models
import pytest

# Tests never hit a real model API.
pydantic_ai.models.ALLOW_MODEL_REQUESTS = False

from audio_angel.helpers.telemetry import setup_logfire
from audio_angel.models import Segment, Transcript, Word

setup_logfire()


@pytest.fixture(autouse=True)
def _tmp_data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AUDIO_ANGEL_DATA_DIR", str(tmp_path / "data"))
    # Provider construction validates the key exists; ALLOW_MODEL_REQUESTS
    # above guarantees it is never used. Only stub when no real key is
    # configured (judge tests need the real one).
    import os

    if not os.environ.get("FIREWORKS_API_KEY", "").strip():
        monkeypatch.setenv("FIREWORKS_API_KEY", "fw-test-key")
    yield


def make_segment(index: int, text: str, start_ms: int, step_ms: int = 500) -> Segment:
    words = []
    cursor = start_ms
    for token in text.split():
        words.append(Word(start_ms=cursor, end_ms=cursor + 400, text=token))
        cursor += step_ms
    return Segment(
        index=index,
        start_ms=start_ms,
        end_ms=cursor - step_ms + 400,
        text=text,
        words=words,
    )


@pytest.fixture
def music_transcript() -> Transcript:
    segments = [
        make_segment(0, "hello there my friend", 0),
        make_segment(1, "this is a damn good day", 5000),
        make_segment(2, "damn damn what a day", 10000),
    ]
    return Transcript(
        source_key="aud:test1",
        kind="music",
        duration_ms=20000,
        segments=segments,
    )


@pytest.fixture
def podcast_transcript() -> Transcript:
    segments = [
        make_segment(0, "welcome back to the show", 0),
        make_segment(1, "today we discuss drug policy", 4000),
    ]
    return Transcript(
        source_key="pod:abc",
        kind="podcast",
        duration_ms=9000,
        segments=segments,
    )


class FakeEmbedder:
    """Deterministic bag-of-token-hashes embedder: texts sharing tokens
    have high cosine similarity."""

    DIM = 256

    def embed(self, texts: list[str]) -> np.ndarray:
        matrix = np.zeros((len(texts), self.DIM), dtype=np.float32)
        for i, text in enumerate(texts):
            for token in text.lower().split():
                digest = hashlib.sha256(token.encode()).digest()
                matrix[i, digest[0] % self.DIM] += 1.0
        return matrix


@pytest.fixture
def fake_embedder() -> FakeEmbedder:
    return FakeEmbedder()
