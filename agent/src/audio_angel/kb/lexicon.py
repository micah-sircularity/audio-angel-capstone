"""The flagging knowledge base: a curated lexicon of terms the agent can
look up when a transcript line might be slang, a euphemism or a censored
spelling. Shipped as package data at data/lexicon.jsonl.
"""

from __future__ import annotations

import json
from typing import Literal

from pydantic import BaseModel, Field

from audio_angel.agent.prompts import CATEGORY_DEFINITIONS
from audio_angel.helpers.paths import lexicon_path

Category = Literal["profanity", "slurs", "sexual", "drugs", "violence", "blasphemy"]
CATEGORIES: tuple[str, ...] = tuple(CATEGORY_DEFINITIONS.keys())


class LexiconEntry(BaseModel):
    id: str
    term: str
    variants: list[str] = Field(default_factory=list)
    category: Category
    definition: str
    severity: Literal["mild", "strong"]


def load_lexicon() -> list[LexiconEntry]:
    """Load the committed lexicon.jsonl, validating every entry."""
    entries: list[LexiconEntry] = []
    for line_number, line in enumerate(
        lexicon_path().read_text().splitlines(), start=1
    ):
        line = line.strip()
        if not line:
            continue
        try:
            entries.append(LexiconEntry.model_validate(json.loads(line)))
        except (json.JSONDecodeError, ValueError) as exc:
            raise ValueError(f"lexicon.jsonl line {line_number}: {exc}") from exc
    return entries


def entry_doc(entry: LexiconEntry) -> dict:
    """Retriever document for one lexicon entry."""
    return {
        "id": entry.id,
        "term": entry.term,
        "variants": " ".join(entry.variants),
        "category": entry.category,
        "definition": entry.definition,
        "text": f"{entry.term} {' '.join(entry.variants)} {entry.definition}",
    }
