"""Flagging eval (pydantic_evals): runs the flagging agent over a
ground-truth dataset and scores it deterministically + with the LLM
judge. Writes reports/eval.md and reports/eval-<ts>.json.

Usage:
  uv run python evals/run_eval.py [--dataset human|feedback]
      [--config key=value ...] [--limit N] [--no-judge]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import argparse
import asyncio
import json
from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import logfire
from pydantic_core import to_jsonable_python
from pydantic_evals import Case, Dataset, set_eval_attribute
from pydantic_evals.evaluators import Evaluator, EvaluatorContext, LLMJudge

from audio_angel.agent.flagger import flag_transcript
from audio_angel.config import GLM_FLASH, AgentConfig
from audio_angel.helpers.ground_truth import (
    ExpectedFlag,
    load_all,
)
from audio_angel.models import LineFlag, MuteRule, Transcript
from evals.judge import JUDGE_RUBRIC, JUDGE_SCORE_RUBRIC
from evals.metrics import CaseMetrics, DatasetSummary, case_metrics, summarize

REPORTS = Path(__file__).resolve().parent.parent / "reports"


@dataclass
class FlagInputs:
    transcript: Transcript
    rules: list[MuteRule]


class PairMetrics(Evaluator):
    """Deterministic precision/recall/F1 over (line_index, rule_id) pairs."""

    def evaluate(self, ctx: EvaluatorContext) -> dict[str, float]:
        m = case_metrics(ctx.output, ctx.expected_output)
        return {"precision": m.precision, "recall": m.recall, "f1": m.f1}


class WordRecall(Evaluator):
    """Coverage of expected word tokens over matched pairs."""

    def evaluate(self, ctx: EvaluatorContext) -> dict[str, float]:
        m = case_metrics(ctx.output, ctx.expected_output)
        return {} if m.word_recall is None else {"word_recall": m.word_recall}


class TranscriptJudge(LLMJudge):
    """Give the judge classification evidence without irrelevant word timing."""

    async def evaluate(self, ctx: EvaluatorContext):
        inputs = ctx.inputs
        compact = {
            "kind": inputs.transcript.kind,
            "lines": [
                {"index": s.index, "text": s.text} for s in inputs.transcript.segments
            ],
            "rules": [
                {"id": rule.id, "definition": rule.definition} for rule in inputs.rules
            ],
        }
        return await super().evaluate(replace(ctx, inputs=compact))


def _flag_dicts(flags: list[LineFlag]) -> list[dict]:
    return [
        {
            "line_index": f.line_index,
            "rule_id": f.rule_id,
            "words": f.words,
            "confidence": f.confidence,
        }
        for f in flags
    ]


def build_dataset(labeled_by: str, limit: int | None) -> Dataset:
    gts = load_all(labeled_by)
    if limit:
        gts = gts[:limit]
    cases = [
        Case(
            name=gt.source_key,
            inputs=FlagInputs(transcript=gt.transcript, rules=gt.rules),
            expected_output=gt.expected,
            metadata={"title": gt.title, "kind": gt.kind},
        )
        for gt in gts
    ]
    return Dataset(name=f"flagging-{labeled_by}", cases=cases)


def build_evaluators(judge: bool) -> list[Evaluator]:
    evaluators: list[Evaluator] = [PairMetrics(), WordRecall()]
    if judge:
        evaluators += [
            TranscriptJudge(
                rubric=JUDGE_RUBRIC,
                model=GLM_FLASH,
                include_input=True,
                include_expected_output=True,
                assertion={
                    "evaluation_name": "judge_pass",
                    "include_reason": True,
                },
                score=False,
            ),
            TranscriptJudge(
                rubric=JUDGE_SCORE_RUBRIC,
                model=GLM_FLASH,
                include_input=True,
                include_expected_output=True,
                score={"evaluation_name": "judge_score", "include_reason": True},
                assertion=False,
            ),
        ]
    return evaluators


JUDGE_ASSERTION = "judge_pass"


def judge_outcome(case) -> bool | None:
    """Pass/fail from the named judge assertion; None on judge error.

    ReportCase.assertions values are EvaluationResult[bool] — read
    .value, never truthiness. Evaluator failures are judge errors and
    must be excluded from the pass-rate denominator.
    """
    if getattr(case, "evaluator_failures", None):
        return None
    result = (case.assertions or {}).get(JUDGE_ASSERTION)
    if result is None:
        return None
    return bool(getattr(result, "value", result))


async def evaluate_config(
    config: AgentConfig,
    dataset: Dataset,
    *,
    judge: bool = True,
) -> tuple[Any, DatasetSummary, list[CaseMetrics], list[dict]]:
    """Run one config over the dataset; returns (report, summary, per-case
    metrics, per-case raw outputs for threshold re-scoring)."""

    async def task(inputs: FlagInputs) -> list[LineFlag]:
        try:
            result = await flag_transcript(inputs.transcript, inputs.rules, config)
        except Exception as exc:
            print(
                f"{config.name}: failed {inputs.transcript.source_key}: "
                f"{type(exc).__name__}: {exc}",
                flush=True,
            )
            raise
        set_eval_attribute("latency_ms", result.latency_ms)
        set_eval_attribute("input_tokens", result.input_tokens)
        set_eval_attribute("output_tokens", result.output_tokens)
        set_eval_attribute("requests", result.requests)
        set_eval_attribute("raw_flags", _flag_dicts(result.raw_flags))
        return result.flags

    dataset.evaluators = build_evaluators(judge)
    # Each transcript already runs up to four chunks concurrently. Running
    # every case at once multiplies that fan-out and exhausts provider limits.
    report = await dataset.evaluate(task, name=config.name, max_concurrency=1)

    per_case: list[CaseMetrics] = []
    raw_per_case: list[dict] = []
    latencies: list[float] = []
    in_tok = out_tok = 0
    judge_results: list[bool] = []
    judge_errors = 0
    for case in report.cases:
        expected = [
            ExpectedFlag.model_validate(e) if isinstance(e, dict) else e
            for e in (case.expected_output or [])
        ]
        per_case.append(case_metrics(case.output or [], expected))
        attrs = case.attributes or {}
        latencies.append(float(attrs.get("latency_ms", 0)))
        in_tok += int(attrs.get("input_tokens", 0))
        out_tok += int(attrs.get("output_tokens", 0))
        raw_per_case.append(
            {
                "source_key": case.name,
                "expected": [e.model_dump() for e in expected],
                "raw_flags": attrs.get("raw_flags", []),
            }
        )
        if judge:
            verdict = judge_outcome(case)
            if verdict is None:
                judge_errors += 1
            else:
                judge_results.append(verdict)
    # Task failures are scored as all-FN cases, never dropped.
    failures = list(getattr(report, "failures", []) or [])
    expected_by_name = {c.name: c.expected_output for c in dataset.cases}
    for failure in failures:
        expected = getattr(failure, "expected_output", None)
        if expected is None:
            expected = expected_by_name.get(failure.name, [])
        expected = [
            ExpectedFlag.model_validate(e) if isinstance(e, dict) else e
            for e in expected
        ]
        per_case.append(case_metrics([], expected))
        raw_per_case.append(
            {
                "source_key": failure.name,
                "expected": [e.model_dump() for e in expected],
                "raw_flags": [],
                "error": getattr(failure, "error_message", str(failure)),
            }
        )
    summary = summarize(
        per_case,
        latencies_ms=latencies,
        input_tokens=in_tok,
        output_tokens=out_tok,
        judge_results=judge_results if judge else None,
        judge_errors=judge_errors,
        failed_cases=len(failures),
    )
    return report, summary, per_case, raw_per_case


def _parse_overrides(pairs: list[str]) -> dict:
    out: dict = {}
    for pair in pairs:
        key, _, value = pair.partition("=")
        if key in ("chunk_size",):
            out[key] = int(value)
        elif key in ("min_confidence",):
            out[key] = float(value)
        elif key in ("tools_enabled", "lexicon_prematch"):
            out[key] = value.lower() in ("1", "true", "yes")
        else:
            out[key] = value
    return out


def write_reports(
    config: AgentConfig,
    summary: DatasetSummary,
    report,
    per_case: list[CaseMetrics],
) -> Path:
    REPORTS.mkdir(exist_ok=True)
    lines = [
        f"# Flagging eval — `{config.name}`",
        "",
        (
            f"{summary.cases} cases · "
            f"micro P/R/F1 {summary.micro_precision:.3f}/{summary.micro_recall:.3f}"
            f"/{summary.micro_f1:.3f} · macro F1 {summary.macro_f1:.3f} · "
            f"word recall {summary.mean_word_recall if summary.mean_word_recall is not None else '—'} · "
            f"judge pass {f'{summary.judge_pass_rate:.0%}' if summary.judge_pass_rate is not None else '—'} · "
            f"failed cases {summary.failed_cases} · judge errors {summary.judge_errors}"
        ),
        "",
        (
            f"latency mean {summary.mean_latency_ms:.0f} ms · tokens "
            f"{summary.input_tokens}+{summary.output_tokens} · "
            f"est. cost ${summary.est_cost_usd:.4f}"
        ),
        "",
        "| case | P | R | F1 | word recall | judge |",
        "|---|---|---|---|---|---|",
    ]
    for case, m in zip(report.cases, per_case, strict=False):
        judge_cell = (
            "/".join(
                f"{k}={'✓' if getattr(v, 'value', v) else '✗'}"
                for k, v in (case.assertions or {}).items()
            )
            or "—"
        )
        lines.append(
            f"| {case.name} | {m.precision:.2f} | {m.recall:.2f} | {m.f1:.2f} "
            f"| {m.word_recall if m.word_recall is not None else '—'} | {judge_cell} |"
        )
    failures = list(getattr(report, "failures", []) or [])
    if failures:
        lines += ["", "## Failed cases", ""]
        for failure in failures:
            lines.append(f"- {failure.name}: {getattr(failure, 'error_message', '?')}")
    (REPORTS / "eval.md").write_text("\n".join(lines) + "\n")
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    raw_path = REPORTS / f"eval-{stamp}.json"
    try:
        payload = report.model_dump(mode="json")
    except AttributeError:
        payload = asdict(report)
    payload = {"config": asdict(config), "summary": asdict(summary), "report": payload}
    raw_path.write_text(json.dumps(to_jsonable_python(payload, fallback=str), indent=2))
    return raw_path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", choices=["human", "feedback"], default="human")
    parser.add_argument(
        "--config",
        action="append",
        default=[],
        help="key=value override (prompt_version, chunk_size, "
        "search_method, min_confidence, tools_enabled)",
    )
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--no-judge", action="store_true")
    args = parser.parse_args()

    logfire.configure(
        service_name="audio-angel-eval", send_to_logfire="if-token-present"
    )
    logfire.instrument_pydantic_ai()
    logfire.instrument_httpx()

    config = AgentConfig(**_parse_overrides(args.config))
    dataset = build_dataset(args.dataset, args.limit)
    if not dataset.cases:
        raise SystemExit(
            f"No ground-truth files under evals/data/"
            f"{'ground_truth' if args.dataset == 'human' else 'ground_truth_feedback'}/"
        )
    report, summary, per_case, _ = asyncio.run(
        evaluate_config(config, dataset, judge=not args.no_judge)
    )
    path = write_reports(config, summary, report, per_case)
    print(f"config: {config.name}")
    print(
        f"micro F1 {summary.micro_f1:.3f} · macro F1 {summary.macro_f1:.3f} · "
        f"cases {summary.cases} · cost ${summary.est_cost_usd:.4f}"
    )
    print(f"wrote reports/eval.md and {path}")


if __name__ == "__main__":
    main()
