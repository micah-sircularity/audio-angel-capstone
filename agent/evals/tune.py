"""Tuning driver: evaluates BASELINE + STAGE1, picks the stage-1 winner
by micro F1 (ties -> lower mean latency), runs stage 2 (retriever
methods + tools-off ablation on the winner), and stage 3 re-scores the
stage-2 winner's RAW flags at each threshold — no new model calls.
Writes reports/tuning.md. Use --limit N for smoke runs.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import argparse
import asyncio
import json
from dataclasses import asdict, replace

from audio_angel.ground_truth import ExpectedFlag
from audio_angel.models import LineFlag
from evals.experiments import (
    BASELINE,
    STAGE1,
    STAGE2_PREMATCH,
    STAGE2_SEARCH_METHODS,
    STAGE3_THRESHOLDS,
)
from evals.metrics import case_metrics, summarize
from evals.run_eval import build_dataset, evaluate_config

REPORTS = __import__("pathlib").Path(__file__).resolve().parent.parent / "reports"


def _summary_row(config_name: str, summary) -> str:
    wr = (
        f"{summary.mean_word_recall:.3f}"
        if summary.mean_word_recall is not None
        else "—"
    )
    jr = (
        f"{summary.judge_pass_rate:.0%}" if summary.judge_pass_rate is not None else "—"
    )
    return (
        f"| {config_name} | {summary.micro_precision:.3f} | "
        f"{summary.micro_recall:.3f} | {summary.micro_f1:.3f} | "
        f"{summary.macro_f1:.3f} | {wr} | {jr} | "
        f"{summary.mean_latency_ms:.0f} | "
        f"{summary.input_tokens}+{summary.output_tokens} | "
        f"${summary.est_cost_usd:.4f} | {summary.failed_cases} |"
    )


HEADER = (
    "| config | micro P | micro R | micro F1 | macro F1 | word recall | "
    "judge pass | latency ms | tokens in+out | cost | failed |\n"
    "|---|---|---|---|---|---|---|---|---|---|---|"
)


def _checkpoint(lines, config, summary, raw) -> None:
    REPORTS.mkdir(exist_ok=True)
    (REPORTS / f"tuning-{config.name}.json").write_text(
        json.dumps(
            {"config": asdict(config), "summary": asdict(summary), "cases": raw},
            indent=2,
        )
        + "\n"
    )
    (REPORTS / "tuning.md").write_text("\n".join(lines) + "\n")


async def tune(limit: int | None, judge: bool) -> str:
    dataset = build_dataset("human", limit)
    if not dataset.cases:
        raise SystemExit("No ground-truth files in evals/data/ground_truth/")

    lines = ["# Flagging tuning", ""]
    lines.append(
        f"{len(dataset.cases)} cases (limit={limit}) · judge={'on' if judge else 'off'}"
    )
    lines += ["", "## Stage 1 — prompt x chunk", HEADER]

    stage1 = [BASELINE, *STAGE1]
    results = {}
    for config in stage1:
        _report, summary, per_case, raw = await evaluate_config(
            config, dataset, judge=judge
        )
        results[config.name] = (config, summary, raw)
        lines.append(_summary_row(config.name, summary))
        _checkpoint(lines, config, summary, raw)
        print(f"stage1 {config.name}: micro F1 {summary.micro_f1:.3f}")

    winner_name = min(
        results,
        key=lambda n: (-results[n][1].micro_f1, results[n][1].mean_latency_ms),
    )
    stage1_winner, _winner_summary, _ = results[winner_name]
    lines += ["", f"**Stage-1 winner: `{winner_name}`**", ""]
    lines += ["## Stage 2 — retriever + tools ablation", HEADER]

    stage2_configs = [
        replace(stage1_winner, search_method=m, lexicon_prematch=p)
        for m in STAGE2_SEARCH_METHODS
        for p in STAGE2_PREMATCH
    ] + [
        replace(stage1_winner, tools_enabled=False, lexicon_prematch=p)
        for p in STAGE2_PREMATCH
    ]
    stage2_results = {}
    for config in stage2_configs:
        if config.name in results:
            _report, summary, per_case, raw = (
                results[config.name][0],
                results[config.name][1],
                None,
                results[config.name][2],
            )
        else:
            _report, summary, per_case, raw = await evaluate_config(
                config, dataset, judge=judge
            )
        stage2_results[config.name] = (config, summary, raw)
        lines.append(_summary_row(config.name, summary))
        _checkpoint(lines, config, summary, raw)
        print(f"stage2 {config.name}: micro F1 {summary.micro_f1:.3f}")

    stage2_winner_name = min(
        stage2_results,
        key=lambda n: (
            -stage2_results[n][1].micro_f1,
            stage2_results[n][1].mean_latency_ms,
        ),
    )
    _stage2_winner, _stage2_summary, stage2_raw = stage2_results[stage2_winner_name]
    lines += ["", f"**Stage-2 winner: `{stage2_winner_name}`**", ""]
    lines += ["## Stage 3 — confidence threshold (re-scored raw flags)", HEADER]

    best_threshold = None
    best_key = None
    for threshold in STAGE3_THRESHOLDS:
        per_case = []
        for case_raw in stage2_raw or []:
            expected = [ExpectedFlag.model_validate(e) for e in case_raw["expected"]]
            kept = [
                LineFlag.model_validate(f)
                for f in case_raw["raw_flags"]
                if f.get("confidence", 0) >= threshold
            ]
            per_case.append(case_metrics(kept, expected))
        summary = summarize(per_case)
        name = f"{stage2_winner_name}-thr{threshold}"
        lines.append(_summary_row(name, summary))
        print(f"stage3 {name}: micro F1 {summary.micro_f1:.3f}")
        key = (summary.micro_f1, summary.micro_precision, threshold)
        if best_key is None or key > best_key:
            best_key, best_threshold = key, threshold

    overall = replace(_stage2_winner, min_confidence=best_threshold)
    lines += ["", f"**Overall winner: `{overall.name}`**", ""]
    REPORTS.mkdir(exist_ok=True)
    (REPORTS / "tuning.md").write_text("\n".join(lines) + "\n")
    return overall.name


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--no-judge", action="store_true")
    args = parser.parse_args()

    import logfire

    logfire.configure(
        service_name="audio-angel-eval", send_to_logfire="if-token-present"
    )
    logfire.instrument_pydantic_ai()
    logfire.instrument_httpx()

    winner = asyncio.run(tune(args.limit, not args.no_judge))
    print(f"\nWinner: {winner} — see reports/tuning.md")


if __name__ == "__main__":
    main()
