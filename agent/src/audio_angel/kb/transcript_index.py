"""Indexes transcript segments as retriever docs for the
search_transcript tool. Each segment contributes its own line doc plus a
window doc joining it with its immediate neighbours, so phrase queries
that span a line boundary still hit.
"""

from __future__ import annotations

from audio_angel.kb.search import Doc, Embedder, Retriever, build_retriever
from audio_angel.models import Transcript


def transcript_docs(transcript: Transcript) -> list[Doc]:
    docs: list[Doc] = []
    segments = transcript.segments
    for i, segment in enumerate(segments):
        docs.append(
            {
                "id": f"line:{segment.index}",
                "index": segment.index,
                "text": segment.text,
            }
        )
        neighbours = segments[max(0, i - 1) : i + 2]
        docs.append(
            {
                "id": f"window:{segment.index}",
                "index": segment.index,
                "text": " ".join(s.text for s in neighbours),
            }
        )
    return docs


def build_transcript_retriever(
    transcript: Transcript,
    method: str,
    *,
    embedder: Embedder | None = None,
) -> Retriever:
    return build_retriever(method, transcript_docs(transcript), embedder=embedder)
