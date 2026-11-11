"""Retrieval eval: hit@1/3/5 + MRR@10 for each retriever method over the
lexicon, scored against evals/data/retrieval_queries.jsonl and broken
down by query type. Vector/hybrid need FIREWORKS_API_KEY; without it
this runs text only and says so in the report.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import argparse
import json
import os
from collections import defaultdict

from audio_angel.kb.lexicon import entry_doc, load_lexicon
from audio_angel.kb.search import build_retriever

REPORTS = Path(__file__).resolve().parent.parent / "reports"
QUERIES = Path(__file__).resolve().parent / "data" / "retrieval_queries.jsonl"


def hit_at_k(ranking: list[str], relevant: set[str], k: int) -> float:
    return 1.0 if relevant & set(ranking[:k]) else 0.0


def mrr(ranking: list[str], relevant: set[str], k: int = 10) -> float:
    for i, doc_id in enumerate(ranking[:k]):
        if doc_id in relevant:
            return 1.0 / (i + 1)
    return 0.0


def score_method(retriever, queries: list[dict]) -> dict:
    """Aggregate metrics for one retriever over all queries."""
    totals = {"hit@1": 0.0, "hit@3": 0.0, "hit@5": 0.0, "mrr": 0.0}
    by_type: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for q in queries:
        relevant = set(q["relevant"])
        ranking = [doc_id for doc_id, _ in retriever.search(q["query"], k=10)]
        scores = {
            "hit@1": hit_at_k(ranking, relevant, 1),
            "hit@3": hit_at_k(ranking, relevant, 3),
            "hit@5": hit_at_k(ranking, relevant, 5),
            "mrr": mrr(ranking, relevant),
        }
        for metric, value in scores.items():
            totals[metric] += value
            by_type[q["type"]][metric].append(value)
    n = len(queries)
    return {
        "overall": {m: v / n for m, v in totals.items()},
        "by_type": {
            t: {m: sum(vs) / len(vs) for m, vs in metrics.items()}
            for t, metrics in by_type.items()
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--methods",
        default="text,vector,hybrid",
        help="comma-separated retriever methods to evaluate",
    )
    args = parser.parse_args()

    queries = [json.loads(l) for l in QUERIES.read_text().splitlines() if l.strip()]
    docs = [entry_doc(e) for e in load_lexicon()]

    methods = [m.strip() for m in args.methods.split(",") if m.strip()]
    have_key = bool(os.environ.get("FIREWORKS_API_KEY", "").strip())
    ran: list[str] = []
    skipped: list[str] = []
    results: dict[str, dict] = {}
    for method in methods:
        if method in ("vector", "hybrid") and not have_key:
            skipped.append(method)
            continue
        retriever = build_retriever(method, docs)
        results[method] = score_method(retriever, queries)
        ran.append(method)

    lines = ["# Retrieval eval — lexicon search", ""]
    lines.append(f"{len(queries)} queries from `{QUERIES.name}`")
    lines.append("")
    if skipped:
        lines.append(f"**Skipped {', '.join(skipped)}: FIREWORKS_API_KEY not set.**")
        lines.append("")
    header = "| method | hit@1 | hit@3 | hit@5 | MRR@10 |"
    lines += [header, "|---|---|---|---|---|"]
    best, best_score = None, -1.0
    for method, result in results.items():
        o = result["overall"]
        score = o["hit@5"] + o["mrr"]
        if score > best_score:
            best, best_score = method, score
        lines.append(
            f"| {method} | {o['hit@1']:.3f} | {o['hit@3']:.3f} | "
            f"{o['hit@5']:.3f} | {o['mrr']:.3f} |"
        )
    for method, result in results.items():
        lines.append("")
        lines.append(f"## {method} by query type")
        lines.append("| type | hit@1 | hit@3 | hit@5 | MRR@10 | n |")
        lines.append("|---|---|---|---|---|---|")
        counts = defaultdict(int)
        for q in queries:
            counts[q["type"]] += 1
        for qtype, metrics in sorted(result["by_type"].items()):
            lines.append(
                f"| {qtype} | {metrics['hit@1']:.3f} | {metrics['hit@3']:.3f} "
                f"| {metrics['hit@5']:.3f} | {metrics['mrr']:.3f} | {counts[qtype]} |"
            )
    REPORTS.mkdir(exist_ok=True)
    (REPORTS / "retrieval.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    if best:
        print(f"\nWinner: {best}")
    if skipped:
        print(f"(text-only run: {', '.join(skipped)} need FIREWORKS_API_KEY)")


if __name__ == "__main__":
    main()
