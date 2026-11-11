"""Re-score saved flags against the current labels.

No model calls: reads raw (pre-threshold) flags, takes expected flags from
the current human ground truth, and sweeps the confidence threshold. Use
after a label correction, or to compare saved runs on equal terms.

    uv run python evals/rescore.py                     # feedback comparison
    uv run python evals/rescore.py reports/eval-*.json # saved eval runs
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import json

from audio_angel.helpers.ground_truth import load_all
from audio_angel.models import LineFlag
from evals.experiments import STAGE3_THRESHOLDS
from evals.metrics import case_metrics, summarize
from evals.run_eval import REPORTS

HEADER = [
    "| config | threshold | precision | recall | micro F1 | macro F1 | word recall | failed |",
    "|---|---|---|---|---|---|---|---|",
]


def _comparison_runs() -> list[tuple[str, list[dict]]]:
    rows = json.loads((REPORTS / "feedback-comparison.json").read_text())
    return [(row["config"]["prompt_version"], row["cases"]) for row in rows]


def _eval_runs(paths: list[str]) -> list[tuple[str, list[dict]]]:
    runs = []
    for path in paths:
        data = json.loads(Path(path).read_text())
        cases = [
            {
                "source_key": case["name"],
                "raw_flags": (case.get("attributes") or {}).get("raw_flags", []),
            }
            for case in data["report"]["cases"]
        ]
        cases += [
            {"source_key": failure["name"], "raw_flags": [], "error": True}
            for failure in data["report"].get("failures") or []
        ]
        config = data["config"]
        tools = "tools" if config["tools_enabled"] else "no tools"
        label = f"{config['prompt_version']} chunk{config['chunk_size']} {tools}"
        runs.append((label, cases))
    return runs


def main() -> None:
    expected = {gt.source_key: gt.expected for gt in load_all("human")}
    paths = sys.argv[1:]
    runs = _eval_runs(paths) if paths else _comparison_runs()
    lines = [
        "# Saved flags re-scored on current labels",
        "",
        "Raw flags from "
        + (
            ", ".join(f"`{Path(p).name}`" for p in paths)
            or "`feedback-comparison.json`"
        )
        + ", scored against the current `ground_truth/` labels (no new model calls).",
        "",
        *HEADER,
    ]
    for name, cases in runs:
        failed = sum(1 for c in cases if c.get("error"))
        for threshold in STAGE3_THRESHOLDS:
            per_case = [
                case_metrics(
                    [
                        LineFlag.model_validate(f)
                        for f in case["raw_flags"]
                        if f.get("confidence", 0) >= threshold
                    ],
                    expected[case["source_key"]],
                )
                for case in cases
            ]
            s = summarize(per_case)
            wr = "—" if s.mean_word_recall is None else f"{s.mean_word_recall:.3f}"
            lines.append(
                f"| {name} | {threshold} | {s.micro_precision:.3f} | "
                f"{s.micro_recall:.3f} | {s.micro_f1:.3f} | {s.macro_f1:.3f} | "
                f"{wr} | {failed} |"
            )
    out = REPORTS / ("ablations.md" if paths else "feedback-rescored.md")
    out.write_text("\n".join(lines) + "\n")
    print(out.read_text())


if __name__ == "__main__":
    main()
