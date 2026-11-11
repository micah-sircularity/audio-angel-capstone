"""Paired feedback evaluation; save each run before starting the next.

Compare v3 and v4 on the same corrected human labels, with judge feedback.
This is development-set evidence, not an independent generalization estimate.
"""

from __future__ import annotations

import asyncio
import json
import sys
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from audio_angel.config import AgentConfig
from evals.run_eval import REPORTS, build_dataset, evaluate_config, write_reports


async def main() -> None:
    dataset = build_dataset("human", None)
    rows = []
    for version in ("v3", "v4"):
        config = AgentConfig(prompt_version=version)
        report, summary, metrics, raw = await evaluate_config(
            config, dataset, judge=True
        )
        report_path = write_reports(config, summary, report, metrics)
        judge_scores = [
            float(case.scores["judge_score"].value)
            for case in report.cases
            if "judge_score" in (case.scores or {})
        ]
        row = {
            "config": asdict(config),
            "summary": asdict(summary),
            "mean_judge_score": sum(judge_scores) / len(judge_scores)
            if judge_scores
            else None,
            "judge_scored_cases": len(judge_scores),
            "report": str(report_path),
            "cases": raw,
        }
        rows.append(row)
        (REPORTS / "feedback-comparison.json").write_text(json.dumps(rows, indent=2))
        print(f"COMPLETED {version}: {json.dumps(asdict(summary))}", flush=True)

    lines = [
        "# Feedback improvement comparison",
        "",
        "Both prompts use identical corrected human labels and per-line lexicon evidence.",
        "This small development set informed v4; these are not held-out accuracy estimates.",
        "Judge ratings are secondary opinions; inspect their explanations and human-label conflicts.",
        "",
        "| prompt | precision | recall | micro F1 | macro F1 | word recall | judge pass | judge score | failed | judge errors |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for row in rows:
        s = row["summary"]

        def fmt(v):
            return "—" if v is None else f"{v:.3f}"

        lines.append(
            f"| {row['config']['prompt_version']} | {s['micro_precision']:.3f} | "
            f"{s['micro_recall']:.3f} | {s['micro_f1']:.3f} | {s['macro_f1']:.3f} | "
            f"{fmt(s['mean_word_recall'])} | {fmt(s['judge_pass_rate'])} | "
            f"{fmt(row['mean_judge_score'])} | {s['failed_cases']} | {s['judge_errors']} |"
        )
    (REPORTS / "feedback-comparison.md").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    import logfire

    logfire.configure(
        service_name="audio-angel-feedback-eval", send_to_logfire="if-token-present"
    )
    logfire.instrument_pydantic_ai()
    logfire.instrument_httpx()
    asyncio.run(main())
