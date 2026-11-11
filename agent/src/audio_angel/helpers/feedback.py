"""User feedback on flags: appended to data/logs/feedback.jsonl from
the Listen page, converted into ground truth by evals/feedback_to_gt.py.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

from audio_angel.helpers.paths import logs_dir

Verdict = Literal["up", "down", "missed"]


class FeedbackRecord(BaseModel):
    run_id: str
    source_key: str
    line_index: int
    rule_id: str
    words: list[str]
    confidence: float | None = None
    verdict: Verdict


def feedback_path() -> Path:
    return logs_dir() / "feedback.jsonl"


def append_feedback(records: list[FeedbackRecord]) -> Path:
    """Append one JSON line per record; returns the file path."""
    path = feedback_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(UTC).isoformat()
    with path.open("a") as f:
        for record in records:
            row = {"ts": ts, **record.model_dump()}
            f.write(json.dumps(row) + "\n")
    return path


def load_feedback(path: Path | None = None) -> list[dict]:
    path = path or feedback_path()
    if not path.exists():
        return []
    rows = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def runs_path() -> Path:
    return logs_dir() / "runs.jsonl"


def load_runs(path: Path | None = None) -> list[dict]:
    path = path or runs_path()
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
