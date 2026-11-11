"""Logfire setup + one JSON line per pipeline run in data/logs/runs.jsonl."""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime

import logfire

from audio_angel.helpers.paths import logs_dir

_configured = False


def setup_logfire() -> None:
    """Configure Logfire once per process; safe to call repeatedly."""
    global _configured
    if _configured:
        return
    logfire.configure(
        service_name="audio-angel-agent",
        send_to_logfire="if-token-present",
    )
    logfire.instrument_pydantic_ai()
    logfire.instrument_httpx()
    _configured = True


@dataclass
class RunRecord:
    """One row in runs.jsonl — the local run log phase 2 will mine."""

    source_key: str
    title: str
    kind: str
    rule_ids: list[str]
    config: dict
    n_segments: int
    n_flags: int
    n_raw_flags: int
    latency_ms: int
    requests: int
    input_tokens: int
    output_tokens: int
    tool_calls: dict[str, int] = field(default_factory=dict)
    # "modal" | "off" | "failed: <msg>" — whether Spleeter stems were used
    separation: str = "off"
    separation_s: float | None = None
    error: str | None = None


def log_run(record: RunRecord) -> dict:
    """Append one JSON line to data/logs/runs.jsonl; returns the row."""
    row = {
        "run_id": str(uuid.uuid4()),
        "ts": datetime.now(UTC).isoformat(),
        **asdict(record),
    }
    path = logs_dir() / "runs.jsonl"
    with path.open("a") as f:
        f.write(json.dumps(row) + "\n")
    return row
