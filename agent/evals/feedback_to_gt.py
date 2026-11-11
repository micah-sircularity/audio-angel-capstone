"""Convert data/logs/feedback.jsonl + runs.jsonl into feedback-labeled
ground truth in evals/data/ground_truth_feedback/.

Per source_key, the latest run's flags are scored by the user's verdicts:
expected = up flags + missed reports − down flags. Transcripts come from
the transcript cache; rules come from the run record (category/term/topic
rules are reconstructed from the run's rule ids — category ids map
directly, term:/topic: ids map by slug when possible, else skipped with a
note).
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import argparse

from audio_angel.feedback import load_feedback, load_runs
from audio_angel.ground_truth import (
    ExpectedFlag,
    GroundTruth,
    save_ground_truth,
)
from audio_angel.models import MuteRule, category_rule
from audio_angel.transcribe import load_cached_transcript


def rules_from_run(run: dict) -> list[MuteRule]:
    from audio_angel.agent.prompts import CATEGORY_DEFINITIONS

    rules: list[MuteRule] = []
    for rule_id in run.get("rule_ids", []):
        if rule_id in CATEGORY_DEFINITIONS:
            rules.append(category_rule(rule_id))
        elif rule_id.startswith("term:"):
            rules.append(MuteRule(label=rule_id[5:], kind="term", value=rule_id[5:]))
        elif rule_id.startswith("topic:"):
            rules.append(MuteRule(label=rule_id[6:], kind="topic", value=rule_id[6:]))
    return rules


def feedback_ground_truth() -> tuple[list[Path], list[str]]:
    """Build GT files; returns (written paths, skipped source_keys).

    Only feedback from the latest run (by run ts) that has feedback for
    a source counts. Within that run a `down` verdict beats an `up` for
    the same (line, rule) regardless of record order; `missed` adds.
    """
    runs = load_runs()
    feedback = load_feedback()
    ts_by_run = {r["run_id"]: r.get("ts", "") for r in runs}
    latest_run: dict[str, dict] = {}
    for run in runs:
        latest_run[run["source_key"]] = run

    # Latest run *that has feedback* per source, ordered by run ts;
    # unknown run ids rank last.
    def run_ts(run_id: str) -> str:
        return ts_by_run.get(run_id, "")

    fb_run_ids: dict[str, set[str]] = {}
    for record in feedback:
        fb_run_ids.setdefault(record["source_key"], set()).add(record["run_id"])
    chosen_run: dict[str, str] = {}
    for source_key, run_ids in fb_run_ids.items():
        known = [r for r in run_ids if r in ts_by_run]
        chosen_run[source_key] = max(known, key=run_ts) if known else list(run_ids)[-1]

    by_source: dict[str, list[dict]] = {}
    for record in feedback:
        if record["run_id"] == chosen_run.get(record["source_key"]):
            by_source.setdefault(record["source_key"], []).append(record)

    written: list[Path] = []
    skipped: list[str] = []
    for source_key, records in sorted(by_source.items()):
        transcript = load_cached_transcript(source_key)
        if transcript is None:
            skipped.append(source_key)
            continue
        run = latest_run.get(source_key, {})
        ups: dict[tuple[int, str], ExpectedFlag] = {}
        downs: set[tuple[int, str]] = set()
        missed: dict[tuple[int, str], ExpectedFlag] = {}
        for record in records:
            flag = ExpectedFlag(
                line_index=record["line_index"],
                rule_id=record["rule_id"],
                words=record.get("words") or [],
            )
            key = (flag.line_index, flag.rule_id)
            if record["verdict"] == "up":
                ups.setdefault(key, flag)
            elif record["verdict"] == "down":
                downs.add(key)
            elif record["verdict"] == "missed":
                missed.setdefault(key, flag)
        expected = [f for k, f in ups.items() if k not in downs]
        expected += list(missed.values())
        gt = GroundTruth(
            source_key=source_key,
            title=run.get("title", source_key),
            artist="",
            kind=transcript.kind,
            rules=rules_from_run(run),
            transcript=transcript,
            expected=expected,
            labeled_by="feedback",
            prefilled_from=(run.get("config") or {}).get("name"),
            notes=f"from run {run.get('run_id', '?')}",
        )
        written.append(save_ground_truth(gt))
    return written, skipped


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    written, skipped = feedback_ground_truth()
    for path in written:
        print(f"wrote {path}")
    for key in skipped:
        print(f"SKIPPED {key}: no cached transcript")
    print(f"{len(written)} file(s), {len(skipped)} skipped")


if __name__ == "__main__":
    main()
