"""Manual evaluation helper.

`sheet` -> reports/manual_eval_sheet.csv: one row per (case, line, rule)
from the union of expected and predicted flags of the LATEST eval run
JSON (reports/eval-*.json), for a human to fill in `human_verdict`.
`summary` -> reads the filled sheet, writes reports/manual_eval.md.
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

REPORTS = Path(__file__).resolve().parent.parent / "reports"
SHEET = REPORTS / "manual_eval_sheet.csv"

FIELDS = [
    "source_key",
    "line_index",
    "line",
    "rule_id",
    "expected_words",
    "predicted_words",
    "judge_verdict",
    "human_verdict",
    "notes",
]


def _latest_eval_json() -> Path:
    files = sorted(REPORTS.glob("eval-*.json"))
    if not files:
        raise SystemExit("No reports/eval-*.json — run make eval first")
    return files[-1]


def _case_outputs(case: dict) -> list[dict]:
    out = case.get("output")
    if isinstance(out, list):
        return out
    if isinstance(out, dict):
        return out.get("flags", [])
    return []


def write_sheet() -> Path:
    report = _latest_eval_json()
    payload = __import__("json").loads(report.read_text())
    cases = (payload.get("report") or {}).get("cases") or []
    rows: list[dict] = []
    for case in cases:
        name = case.get("name", "")
        inputs = case.get("inputs") or {}
        transcript = inputs.get("transcript") or {}
        segments = {
            s.get("index"): s.get("text", "") for s in transcript.get("segments", [])
        }
        expected = case.get("expected_output") or []
        predicted = _case_outputs(case)
        assertion = (case.get("assertions") or {}).get("judge_pass") or {}
        judge = {True: "pass", False: "fail"}.get(assertion.get("value"), "")
        pairs = {(e["line_index"], e["rule_id"]) for e in expected} | {
            (p["line_index"], p["rule_id"]) for p in predicted
        }
        exp_map = {(e["line_index"], e["rule_id"]): e for e in expected}
        pred_map = {(p["line_index"], p["rule_id"]): p for p in predicted}
        for line_index, rule_id in sorted(pairs):
            rows.append(
                {
                    "source_key": name,
                    "line_index": line_index,
                    "line": segments.get(line_index, ""),
                    "rule_id": rule_id,
                    "expected_words": ", ".join(
                        exp_map.get((line_index, rule_id), {}).get("words") or []
                    ),
                    "predicted_words": ", ".join(
                        pred_map.get((line_index, rule_id), {}).get("words") or []
                    ),
                    "judge_verdict": judge,
                    "human_verdict": "",
                    "notes": "",
                }
            )
    REPORTS.mkdir(exist_ok=True)
    with SHEET.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    return SHEET


def summarize_sheet() -> Path:
    if not SHEET.exists():
        raise SystemExit(f"No {SHEET}; run `sheet` first")
    with SHEET.open() as f:
        rows = list(csv.DictReader(f))
    graded = [r for r in rows if r["human_verdict"].strip()]

    # Row-level precision over rows where the model predicted something.
    predicted_rows = [r for r in graded if r["predicted_words"].strip()]
    correct = [r for r in predicted_rows if r["human_verdict"].strip() == "correct"]
    wrong = [r for r in predicted_rows if r["human_verdict"].strip() == "wrong"]
    precision = len(correct) / (len(correct) + len(wrong)) if correct or wrong else 0.0

    # Case-level agreement: a case passes human review iff every graded
    # row is correct/borderline and none is wrong; cases with ungraded
    # rows are excluded and counted.
    by_case: dict[str, list[dict]] = {}
    for r in rows:
        by_case.setdefault(r["source_key"], []).append(r)
    agreements = 0
    compared = 0
    ungraded_cases = 0
    disagreements: list[dict] = []
    for name, case_rows in by_case.items():
        if any(not r["human_verdict"].strip() for r in case_rows):
            ungraded_cases += 1
            continue
        judge_v = next(
            (r["judge_verdict"] for r in case_rows if r["judge_verdict"]), ""
        )
        if judge_v not in ("pass", "fail"):
            continue
        human_pass = all(
            r["human_verdict"].strip() in ("correct", "borderline") for r in case_rows
        )
        compared += 1
        if human_pass == (judge_v == "pass"):
            agreements += 1
        else:
            disagreements.append(
                {
                    "source_key": name,
                    "judge_verdict": judge_v,
                    "human_verdict": "pass" if human_pass else "fail",
                    "line": case_rows[0]["line"],
                }
            )

    lines = [
        "# Manual evaluation summary",
        "",
        f"Rows graded: {len(graded)} / {len(rows)}",
        f"Human-judged precision (predicted rows): **{precision:.1%}**",
        (
            f"Judge/human case agreement: **{agreements / compared:.1%}** "
            f"({compared} cases compared, {ungraded_cases} excluded ungraded)"
            if compared
            else "No fully-graded cases to compare"
        ),
        "",
        "## Disagreements",
        "",
    ]
    for r in disagreements:
        lines.append(
            f"- {r['source_key']}: judge={r['judge_verdict']} "
            f"human={r['human_verdict']} — {r['line'][:80]}"
        )
    out = REPORTS / "manual_eval.md"
    out.write_text("\n".join(lines) + "\n")
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["sheet", "summary"])
    args = parser.parse_args()
    if args.command == "sheet":
        print(f"wrote {write_sheet()}")
    else:
        print(f"wrote {summarize_sheet()}")


if __name__ == "__main__":
    main()
