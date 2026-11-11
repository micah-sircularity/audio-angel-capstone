"""Shared pydantic models for transcripts, mute rules and agent flags."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field

from audio_angel.agent.prompts import CATEGORY_DEFINITIONS


class Word(BaseModel):
    start_ms: int
    end_ms: int
    text: str


class Segment(BaseModel):
    index: int
    start_ms: int
    end_ms: int
    text: str
    words: list[Word] = Field(default_factory=list)


class Transcript(BaseModel):
    source_key: str
    kind: Literal["music", "podcast"]
    duration_ms: int
    segments: list[Segment]
    # "vocals" = transcribed from the Spleeter vocal stem; "mix" = full
    # mix (default keeps existing caches and ground truth valid).
    audio_source: Literal["mix", "vocals"] = "mix"


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or "x"


class MuteRule(BaseModel):
    """One listener-defined rule. id is derived from kind + value."""

    label: str
    kind: Literal["category", "term", "topic"]
    value: str

    @property
    def id(self) -> str:
        if self.kind == "category":
            return self.value
        return f"{self.kind}:{_slug(self.value)}"

    @property
    def definition(self) -> str:
        if self.kind == "category":
            return CATEGORY_DEFINITIONS[self.value]
        if self.kind == "term":
            # Free-form: the listener describes what to mute in their own
            # words; the model judges by meaning, not exact spelling.
            return (
                f'Words or phrases that fit this description: "{self.value}". '
                "Judge by meaning: synonyms, slang, euphemisms and indirect "
                "references count, in any spelling or form. Mute only those words."
            )
        return f"Any line that mentions, discusses or jokes about: {self.value}."


def category_rule(value: str, *, label: str | None = None) -> MuteRule:
    """Build a category MuteRule with a friendly label."""
    if value not in CATEGORY_DEFINITIONS:
        raise ValueError(f"unknown category {value!r}")
    return MuteRule(
        label=label or CATEGORY_DEFINITIONS[value].split(":")[0],
        kind="category",
        value=value,
    )


def term_rule(value: str) -> MuteRule:
    return MuteRule(label=value, kind="term", value=value.strip())


def topic_rule(value: str) -> MuteRule:
    return MuteRule(label=value, kind="topic", value=value.strip())


class LineFlag(BaseModel):
    line_index: int
    rule_id: str
    words: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0)
    reason: str = ""


class FlagBatch(BaseModel):
    """Structured output the flagging agent returns for one chunk."""

    flags: list[LineFlag] = Field(default_factory=list)


class MuteInterval(BaseModel):
    start_ms: int
    end_ms: int
    rule_ids: list[str] = Field(default_factory=list)


class Track(BaseModel):
    """A playable item from a source search."""

    source_key: str
    kind: Literal["music", "podcast"]
    title: str
    artist: str
    duration_ms: int | None = None
    genre: str | None = None
    artwork_url: str | None = None
    audio_url: str | None = None
    # Source-specific ids (audius track id, podcast feed url + guid).
    source_ids: dict[str, str] = Field(default_factory=dict)
