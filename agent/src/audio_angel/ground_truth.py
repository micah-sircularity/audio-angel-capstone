"""Ground-truth flag datasets. Human labels live in
evals/data/ground_truth/<safe source_key>.json; feedback-derived labels
in evals/data/ground_truth_feedback/. Transcripts are snapshotted into
the file so evals never need Deepgram.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from audio_angel.models import MuteRule, Transcript
from audio_angel.paths import safe_key


class ExpectedFlag(BaseModel):
    line_index: int
    rule_id: str
    words: list[str] = Field(default_factory=list)


class GroundTruth(BaseModel):
    source_key: str
    title: str
    artist: str
    kind: Literal["music", "podcast"]
    rules: list[MuteRule]
    transcript: Transcript
    expected: list[ExpectedFlag] = Field(default_factory=list)
    labeled_by: Literal["human", "feedback"] = "human"
    labeled_at: str = ""
    prefilled_from: str | None = None
    notes: str = ""


def _default_gt_root() -> Path:
    # <agent>/evals/data — sibling of data/, resolved from the package.
    return Path(__file__).resolve().parents[2] / "evals" / "data"


def gt_dir(labeled_by: str = "human") -> Path:
    root = _default_gt_root()
    return (
        root / "ground_truth"
        if labeled_by == "human"
        else root / "ground_truth_feedback"
    )


def gt_path(source_key: str, labeled_by: str = "human") -> Path:
    return gt_dir(labeled_by) / f"{safe_key(source_key)}.json"


def save_ground_truth(gt: GroundTruth) -> Path:
    if not gt.labeled_at:
        gt.labeled_at = datetime.now(UTC).isoformat()
    path = gt_path(gt.source_key, gt.labeled_by)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(gt.model_dump_json(indent=2))
    return path


def load_ground_truth(path: Path) -> GroundTruth:
    return GroundTruth.model_validate(json.loads(path.read_text()))


def list_ground_truth(labeled_by: str = "human") -> list[Path]:
    directory = gt_dir(labeled_by)
    if not directory.exists():
        return []
    return sorted(directory.glob("*.json"))


def load_all(labeled_by: str = "human") -> list[GroundTruth]:
    return [load_ground_truth(p) for p in list_ground_truth(labeled_by)]
