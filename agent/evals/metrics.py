"""Deterministic flagging metrics. Pair key = (line_index, rule_id).
Word recall uses the same normalization as plan.py (NFKC, lowercase,
apostrophes dropped, alphanumeric tokens, multiset)."""

from __future__ import annotations

import re
import unicodedata
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Protocol


class FlagLike(Protocol):
    line_index: int
    rule_id: str
    words: list[str]


def _tokens(text: str) -> list[str]:
    normalized = (
        unicodedata.normalize("NFKC", text)
        .lower()
        .replace("\u2019", "")
        .replace("'", "")
    )
    return re.findall(r"[^\W_]+", normalized)


@dataclass
class CaseMetrics:
    tp: int
    fp: int
    fn: int
    precision: float
    recall: float
    f1: float
    word_recall: float | None


def case_metrics(
    predicted: Iterable[FlagLike], expected: Iterable[FlagLike]
) -> CaseMetrics:
    pred = {(f.line_index, f.rule_id): f for f in predicted}
    exp = {(f.line_index, f.rule_id): f for f in expected}
    tp = len(pred.keys() & exp.keys())
    fp = len(pred.keys() - exp.keys())
    fn = len(exp.keys() - pred.keys())
    precision = tp / (tp + fp) if tp + fp else 1.0
    recall = tp / (tp + fn) if tp + fn else 1.0
    f1 = (
        0.0
        if precision + recall == 0
        else 2 * precision * recall / (precision + recall)
    )

    # Word recall over matched pairs with non-empty expected words.
    word_scores: list[float] = []
    for key in pred.keys() & exp.keys():
        expected_words = exp[key].words
        if not expected_words:
            continue
        want = Counter(t for w in expected_words for t in _tokens(w))
        if not want:
            continue
        got = Counter(t for w in pred[key].words for t in _tokens(w))
        covered = sum((want & got).values())
        word_scores.append(covered / sum(want.values()))
    return CaseMetrics(
        tp=tp,
        fp=fp,
        fn=fn,
        precision=precision,
        recall=recall,
        f1=f1,
        word_recall=sum(word_scores) / len(word_scores) if word_scores else None,
    )


@dataclass
class DatasetSummary:
    cases: int
    micro_precision: float
    micro_recall: float
    micro_f1: float
    macro_f1: float
    mean_word_recall: float | None
    judge_pass_rate: float | None
    judge_errors: int
    failed_cases: int
    mean_latency_ms: float
    input_tokens: int
    output_tokens: int
    est_cost_usd: float


INPUT_COST_PER_MTOK = 0.15  # GLM 5.3 Flash on Fireworks
OUTPUT_COST_PER_MTOK = 0.50


def summarize(
    per_case: list[CaseMetrics],
    *,
    latencies_ms: list[float] | None = None,
    input_tokens: int = 0,
    output_tokens: int = 0,
    judge_results: list[bool] | None = None,
    judge_errors: int = 0,
    failed_cases: int = 0,
) -> DatasetSummary:
    tp = sum(c.tp for c in per_case)
    fp = sum(c.fp for c in per_case)
    fn = sum(c.fn for c in per_case)
    precision = tp / (tp + fp) if tp + fp else 1.0
    recall = tp / (tp + fn) if tp + fn else 1.0
    micro_f1 = (
        0.0
        if precision + recall == 0
        else 2 * precision * recall / (precision + recall)
    )
    word_scores = [c.word_recall for c in per_case if c.word_recall is not None]
    return DatasetSummary(
        cases=len(per_case),
        micro_precision=precision,
        micro_recall=recall,
        micro_f1=micro_f1,
        macro_f1=sum(c.f1 for c in per_case) / len(per_case) if per_case else 0.0,
        mean_word_recall=(sum(word_scores) / len(word_scores) if word_scores else None),
        judge_pass_rate=(
            sum(judge_results) / len(judge_results) if judge_results else None
        ),
        judge_errors=judge_errors,
        failed_cases=failed_cases,
        mean_latency_ms=(
            sum(latencies_ms) / len(latencies_ms) if latencies_ms else 0.0
        ),
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        est_cost_usd=(
            input_tokens * INPUT_COST_PER_MTOK / 1e6
            + output_tokens * OUTPUT_COST_PER_MTOK / 1e6
        ),
    )
