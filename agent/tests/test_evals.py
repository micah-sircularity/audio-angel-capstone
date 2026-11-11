"""Offline tests for evals helpers: metrics, ground truth, feedback,
feedback_to_gt, manual_eval, retrieval metrics."""

import json

import pytest

from audio_angel.helpers.feedback import (
    FeedbackRecord,
    append_feedback,
    load_feedback,
)
from audio_angel.helpers.ground_truth import (
    ExpectedFlag,
    GroundTruth,
    list_ground_truth,
    load_ground_truth,
    save_ground_truth,
)
from audio_angel.helpers.paths import cache_dir, safe_key
from audio_angel.helpers.telemetry import RunRecord, log_run
from audio_angel.models import LineFlag, Transcript, category_rule
from evals.feedback_to_gt import feedback_ground_truth
from evals.manual_eval import summarize_sheet, write_sheet
from evals.metrics import case_metrics, summarize
from evals.retrieval_eval import hit_at_k, mrr
from tests.conftest import make_segment


def test_case_metrics_pair_matching():
    pred = [
        LineFlag(line_index=1, rule_id="profanity", words=["damn"], confidence=0.9),
        LineFlag(line_index=2, rule_id="drugs", words=[], confidence=0.9),
    ]
    exp = [
        ExpectedFlag(line_index=1, rule_id="profanity", words=["damn"]),
        ExpectedFlag(line_index=3, rule_id="drugs", words=["weed"]),
    ]
    m = case_metrics(pred, exp)
    assert (m.tp, m.fp, m.fn) == (1, 1, 1)
    assert m.precision == m.recall == m.f1 == 0.5
    assert m.word_recall == 1.0  # "damn" fully covered on the matched pair


def test_case_metrics_empty_sides():
    m = case_metrics([], [])
    assert m.precision == m.recall == 1.0
    m = case_metrics([LineFlag(line_index=0, rule_id="x", words=[], confidence=1)], [])
    assert m.precision == 0.0 and m.recall == 1.0
    m = case_metrics([], [ExpectedFlag(line_index=0, rule_id="x", words=[])])
    assert m.precision == 1.0 and m.recall == 0.0


def test_word_recall_partial_coverage():
    pred = [LineFlag(line_index=0, rule_id="profanity", words=["damn"], confidence=0.9)]
    exp = [ExpectedFlag(line_index=0, rule_id="profanity", words=["damn", "hell"])]
    m = case_metrics(pred, exp)
    assert m.word_recall == 0.5


def test_summarize_aggregates():
    cases = [
        case_metrics(
            [LineFlag(line_index=0, rule_id="a", words=["x"], confidence=1)],
            [ExpectedFlag(line_index=0, rule_id="a", words=["x"])],
        ),
        case_metrics(
            [LineFlag(line_index=1, rule_id="b", words=[], confidence=1)],
            [ExpectedFlag(line_index=2, rule_id="b", words=[])],
        ),
    ]
    s = summarize(
        cases,
        latencies_ms=[100, 300],
        input_tokens=1_000_000,
        output_tokens=1_000_000,
        judge_results=[True, False],
    )
    assert s.micro_precision == 0.5 and s.micro_recall == 0.5
    assert s.macro_f1 == 0.5
    assert s.judge_pass_rate == 0.5
    assert s.mean_latency_ms == 200
    assert s.est_cost_usd == pytest.approx(0.65)


def test_summarize_when_all_judges_fail():
    summary = summarize([], judge_results=[], judge_errors=15)
    assert summary.judge_pass_rate is None
    assert summary.judge_errors == 15


def _gt(source_key="aud:gt1"):
    transcript = Transcript(
        source_key=source_key,
        kind="music",
        duration_ms=5000,
        segments=[make_segment(0, "hello there", 0)],
    )
    return GroundTruth(
        source_key=source_key,
        title="T",
        artist="A",
        kind="music",
        rules=[category_rule("profanity")],
        transcript=transcript,
        expected=[ExpectedFlag(line_index=0, rule_id="profanity", words=[])],
    )


def test_ground_truth_roundtrip(tmp_path, monkeypatch):
    import audio_angel.helpers.ground_truth as gtmod

    monkeypatch.setattr(gtmod, "_default_gt_root", lambda: tmp_path)
    path = save_ground_truth(_gt())
    loaded = load_ground_truth(path)
    assert loaded.source_key == "aud:gt1"
    assert loaded.labeled_by == "human"
    assert loaded.labeled_at
    assert list_ground_truth() == [path]


def test_drafts_are_isolated_from_eval_datasets(tmp_path, monkeypatch):
    """Agent-generated drafts live in their own dir: build_dataset and
    the human/feedback label lists must never see them."""
    import audio_angel.helpers.ground_truth as gtmod

    monkeypatch.setattr(gtmod, "_default_gt_root", lambda: tmp_path)
    draft = _gt().model_copy(update={"labeled_by": "draft"})
    path = save_ground_truth(draft)
    assert "ground_truth_draft" in str(path)
    assert list_ground_truth() == []  # human dataset untouched
    assert list_ground_truth("feedback") == []
    assert list_ground_truth("draft") == [path]
    assert load_ground_truth(path).labeled_by == "draft"


def test_feedback_append_and_load():
    append_feedback(
        [
            FeedbackRecord(
                run_id="r1",
                source_key="aud:x",
                line_index=1,
                rule_id="profanity",
                words=["damn"],
                confidence=0.9,
                verdict="up",
            ),
            FeedbackRecord(
                run_id="r1",
                source_key="aud:x",
                line_index=2,
                rule_id="profanity",
                words=["heck"],
                verdict="missed",
            ),
        ]
    )
    rows = load_feedback()
    assert len(rows) == 2
    assert rows[1]["verdict"] == "missed"
    assert "ts" in rows[0]


def test_feedback_to_gt_builds_file(tmp_path, monkeypatch):
    # Seed a transcript in the cache.
    transcript = Transcript(
        source_key="aud:fb",
        kind="music",
        duration_ms=5000,
        segments=[make_segment(0, "a damn day", 0)],
    )
    (cache_dir("transcripts") / f"{safe_key('aud:fb')}.json").write_text(
        transcript.model_dump_json()
    )
    log_run(
        RunRecord(
            source_key="aud:fb",
            title="S",
            kind="music",
            rule_ids=["profanity", "term:heck"],
            config={"name": "cfg"},
            n_segments=1,
            n_flags=1,
            n_raw_flags=1,
            latency_ms=1,
            requests=1,
            input_tokens=1,
            output_tokens=1,
        )
    )
    append_feedback(
        [
            FeedbackRecord(
                run_id="r",
                source_key="aud:fb",
                line_index=0,
                rule_id="profanity",
                words=["damn"],
                verdict="up",
            ),
            FeedbackRecord(
                run_id="r",
                source_key="aud:fb",
                line_index=0,
                rule_id="term:heck",
                words=["heck"],
                verdict="down",
            ),
            FeedbackRecord(
                run_id="r",
                source_key="aud:fb",
                line_index=0,
                rule_id="profanity",
                words=["day"],
                verdict="missed",
            ),
        ]
    )
    import audio_angel.helpers.ground_truth as gtmod

    monkeypatch.setattr(gtmod, "_default_gt_root", lambda: tmp_path / "gt")
    written, skipped = feedback_ground_truth()
    assert skipped == []
    assert len(written) == 1
    gt = load_ground_truth(written[0])
    assert gt.labeled_by == "feedback"
    assert gt.transcript == transcript
    # up flag kept, down removed (it was never added so nothing to
    # remove — down only removes existing ups), missed added.
    assert (0, "profanity") in {(e.line_index, e.rule_id) for e in gt.expected}


def test_feedback_to_gt_skips_missing_transcript():
    append_feedback(
        [
            FeedbackRecord(
                run_id="r",
                source_key="aud:nope",
                line_index=0,
                rule_id="profanity",
                words=[],
                verdict="up",
            )
        ]
    )
    _, skipped = feedback_ground_truth()
    assert "aud:nope" in skipped


def test_retrieval_metrics():
    ranking = ["a", "b", "c", "d"]
    assert hit_at_k(ranking, {"b"}, 1) == 0.0
    assert hit_at_k(ranking, {"b"}, 3) == 1.0
    assert mrr(ranking, {"b"}) == 0.5
    assert mrr(ranking, {"z"}) == 0.0


def test_manual_eval_sheet_and_summary(tmp_path, monkeypatch):
    import evals.manual_eval as me

    monkeypatch.setattr(me, "REPORTS", tmp_path)
    monkeypatch.setattr(me, "SHEET", tmp_path / "manual_eval_sheet.csv")
    (tmp_path / "eval-20240101.json").write_text(
        json.dumps(
            {
                "report": {
                    "cases": [
                        {
                            "name": "aud:x",
                            "inputs": {
                                "transcript": {
                                    "segments": [{"index": 0, "text": "a damn day"}]
                                }
                            },
                            "expected_output": [
                                {
                                    "line_index": 0,
                                    "rule_id": "profanity",
                                    "words": ["damn"],
                                }
                            ],
                            "output": [
                                {
                                    "line_index": 0,
                                    "rule_id": "profanity",
                                    "words": ["damn"],
                                    "confidence": 0.9,
                                }
                            ],
                            "assertions": {"judge_pass": {"value": True}},
                        }
                    ]
                }
            }
        )
    )
    sheet = write_sheet()
    import csv

    rows = list(csv.DictReader(sheet.open()))
    assert len(rows) == 1
    assert rows[0]["line"] == "a damn day"
    assert rows[0]["judge_verdict"] == "pass"
    rows[0]["human_verdict"] = "correct"
    with sheet.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=rows[0].keys())
        w.writeheader()
        w.writerows(rows)
    out = summarize_sheet()
    text = out.read_text()
    assert "100.0%" in text


# ---------- phase-2 review regression tests ----------

from types import SimpleNamespace

from evals.run_eval import judge_outcome


def _er(value):
    return SimpleNamespace(value=value)


def test_judge_outcome_uses_named_assertion_value():
    case = SimpleNamespace(
        evaluator_failures=[],
        assertions={"judge_pass": _er(True), "other": _er(False)},
    )
    assert judge_outcome(case) is True
    case.assertions["judge_pass"] = _er(False)
    assert judge_outcome(case) is False


def test_judge_outcome_none_on_failure_or_missing():
    case = SimpleNamespace(
        evaluator_failures=[{"evaluator": "LLMJudge", "error": "boom"}],
        assertions={"judge_pass": _er(True)},
    )
    assert judge_outcome(case) is None
    case2 = SimpleNamespace(evaluator_failures=[], assertions={})
    assert judge_outcome(case2) is None


async def test_evaluate_config_counts_failures_as_all_fn(
    music_transcript, tmp_path, monkeypatch
):
    """A task that raises on one case: failure scored as predictions=[]
    (all FN) and counted in summary.failed_cases."""
    from pydantic_evals import Case, Dataset

    from audio_angel.config import AgentConfig
    from audio_angel.helpers.ground_truth import ExpectedFlag
    from audio_angel.models import LineFlag
    from evals.run_eval import FlagInputs, evaluate_config

    rules = [category_rule("profanity")]
    good = LineFlag(line_index=1, rule_id="profanity", words=["damn"], confidence=0.9)
    cases = [
        Case(
            name="aud:ok",
            inputs=FlagInputs(transcript=music_transcript, rules=rules),
            expected_output=[
                ExpectedFlag(line_index=1, rule_id="profanity", words=["damn"])
            ],
        ),
        Case(
            name="aud:boom",
            inputs=FlagInputs(transcript=music_transcript, rules=rules),
            expected_output=[
                ExpectedFlag(line_index=2, rule_id="profanity", words=["x"])
            ],
        ),
    ]
    dataset = Dataset(cases=cases, name="t")

    t_bad = music_transcript.model_copy(update={"source_key": "aud:boom"})
    cases[1].inputs = FlagInputs(transcript=t_bad, rules=rules)
    dataset = Dataset(cases=cases, name="t")

    # evaluate_config builds its own task around flag_transcript; to
    # inject the stub we patch the module symbol.
    import evals.run_eval as re_mod

    original = re_mod.flag_transcript

    async def fake_flag(transcript, rules, config):
        if transcript.source_key == "aud:boom":
            raise RuntimeError("model exploded")
        return SimpleNamespace(
            flags=[good],
            raw_flags=[good],
            requests=1,
            input_tokens=1,
            output_tokens=1,
            latency_ms=5,
            tool_calls={},
        )

    re_mod.flag_transcript = fake_flag
    try:
        _report, summary, _per_case, _raw = await evaluate_config(
            AgentConfig(tools_enabled=False), dataset, judge=False
        )
    finally:
        re_mod.flag_transcript = original
    assert summary.failed_cases == 1
    assert summary.cases == 2
    # good case TP=1, failed case FN=1
    assert summary.micro_recall == 0.5
    failed_raw = next(row for row in _raw if row["source_key"] == "aud:boom")
    assert failed_raw["raw_flags"] == []
    assert failed_raw["expected"][0]["line_index"] == 2
    assert "model exploded" in failed_raw["error"]
    monkeypatch.setattr(re_mod, "REPORTS", tmp_path)
    path = re_mod.write_reports(
        AgentConfig(tools_enabled=False), summary, _report, _per_case
    )
    saved = json.loads(path.read_text())["report"]
    assert saved["cases"][0]["name"] == "aud:ok"
    assert saved["cases"][0]["output"][0]["words"] == ["damn"]
    assert saved["cases"][0]["inputs"]["transcript"]["source_key"]
    assert saved["failures"][0]["name"] == "aud:boom"


def test_feedback_to_gt_uses_latest_run_only(tmp_path, monkeypatch):
    """An older run's down must not delete a newer run's up."""
    transcript = Transcript(
        source_key="aud:fb2",
        kind="music",
        duration_ms=5000,
        segments=[make_segment(0, "a damn day", 0)],
    )
    (cache_dir("transcripts") / f"{safe_key('aud:fb2')}.json").write_text(
        transcript.model_dump_json()
    )
    log_run(
        RunRecord(
            source_key="aud:fb2",
            title="S",
            kind="music",
            rule_ids=["profanity"],
            config={"name": "old"},
            n_segments=1,
            n_flags=0,
            n_raw_flags=0,
            latency_ms=1,
            requests=1,
            input_tokens=1,
            output_tokens=1,
        )
    )
    old_run = log_run(
        RunRecord(
            source_key="aud:fb2",
            title="S",
            kind="music",
            rule_ids=["profanity"],
            config={"name": "new"},
            n_segments=1,
            n_flags=1,
            n_raw_flags=1,
            latency_ms=1,
            requests=1,
            input_tokens=1,
            output_tokens=1,
        )
    )["run_id"]
    append_feedback(
        [
            # newer run: user approves the flag
            FeedbackRecord(
                run_id=old_run,
                source_key="aud:fb2",
                line_index=0,
                rule_id="profanity",
                words=["damn"],
                verdict="up",
            ),
            # stale feedback from a different (older) run id — ignored
            FeedbackRecord(
                run_id="ancient-run",
                source_key="aud:fb2",
                line_index=0,
                rule_id="profanity",
                words=["damn"],
                verdict="down",
            ),
        ]
    )
    import audio_angel.helpers.ground_truth as gtmod

    monkeypatch.setattr(gtmod, "_default_gt_root", lambda: tmp_path / "gt")
    written, skipped = feedback_ground_truth()
    assert skipped == []
    gt = load_ground_truth(written[0])
    # the up from the latest-with-feedback run survives
    assert any(e.rule_id == "profanity" for e in gt.expected)


def test_feedback_to_gt_down_beats_up_same_run(tmp_path, monkeypatch):
    transcript = Transcript(
        source_key="aud:fb3",
        kind="music",
        duration_ms=5000,
        segments=[make_segment(0, "a damn day", 0)],
    )
    (cache_dir("transcripts") / f"{safe_key('aud:fb3')}.json").write_text(
        transcript.model_dump_json()
    )
    run_id = log_run(
        RunRecord(
            source_key="aud:fb3",
            title="S",
            kind="music",
            rule_ids=["profanity"],
            config={"name": "c"},
            n_segments=1,
            n_flags=0,
            n_raw_flags=0,
            latency_ms=1,
            requests=1,
            input_tokens=1,
            output_tokens=1,
        )
    )["run_id"]
    # down recorded BEFORE up in file order — must still win
    append_feedback(
        [
            FeedbackRecord(
                run_id=run_id,
                source_key="aud:fb3",
                line_index=0,
                rule_id="profanity",
                words=["damn"],
                verdict="down",
            ),
            FeedbackRecord(
                run_id=run_id,
                source_key="aud:fb3",
                line_index=0,
                rule_id="profanity",
                words=["damn"],
                verdict="up",
            ),
        ]
    )
    import audio_angel.helpers.ground_truth as gtmod

    monkeypatch.setattr(gtmod, "_default_gt_root", lambda: tmp_path / "gt")
    written, _ = feedback_ground_truth()
    gt = load_ground_truth(written[0])
    assert not any((e.line_index, e.rule_id) == (0, "profanity") for e in gt.expected)


async def test_tune_stages_and_threshold_pick(tmp_path, monkeypatch):
    """tune() with a canned evaluate_config: verifies stage winners and
    stage-3 threshold re-scoring math."""
    import evals.tune as tune_mod
    from evals.metrics import DatasetSummary

    def _summary(f1, p=0.9, r=0.8, lat=100):
        return DatasetSummary(
            cases=1,
            micro_precision=p,
            micro_recall=r,
            micro_f1=f1,
            macro_f1=f1,
            mean_word_recall=None,
            judge_pass_rate=None,
            judge_errors=0,
            failed_cases=0,
            mean_latency_ms=lat,
            input_tokens=0,
            output_tokens=0,
            est_cost_usd=0.0,
        )

    calls = []

    async def fake_eval(config, dataset, *, judge=True):
        calls.append(config.name)
        # Best F1 for the tools-enabled hybrid config.
        f1 = 0.9 if config.tools_enabled and config.search_method == "hybrid" else 0.4
        raw = [
            {
                "source_key": "aud:x",
                "expected": [{"line_index": 0, "rule_id": "profanity", "words": []}],
                "raw_flags": [
                    {
                        "line_index": 0,
                        "rule_id": "profanity",
                        "words": ["d"],
                        "confidence": 0.6,
                        "reason": "r",
                    },
                    {
                        "line_index": 5,
                        "rule_id": "drugs",
                        "words": ["w"],
                        "confidence": 0.4,
                        "reason": "r",
                    },
                ],
            }
        ]
        return None, _summary(f1), [], raw

    monkeypatch.setattr(tune_mod, "evaluate_config", fake_eval)
    monkeypatch.setattr(
        tune_mod,
        "build_dataset",
        lambda kind, limit: SimpleNamespace(
            cases=[SimpleNamespace(name="aud:x", expected_output=[])]
        ),
    )
    import evals.run_eval as re_mod

    monkeypatch.setattr(re_mod, "REPORTS", tmp_path, raising=False)
    monkeypatch.setattr(tune_mod, "REPORTS", tmp_path)

    winner_name = await tune_mod.tune(limit=None, judge=False)
    # stage-2 winner was the hybrid config; stage-3 picked the threshold
    # where the FP (conf 0.4) drops but the TP (conf 0.6) stays = 0.5.
    assert "hybrid" in winner_name
    assert winner_name.endswith("conf0.5"), winner_name
    assert (tmp_path / "tuning.md").exists()
    checkpoint = json.loads((tmp_path / f"tuning-{calls[0]}.json").read_text())
    assert checkpoint["summary"]["failed_cases"] == 0
    assert checkpoint["cases"][0]["source_key"] == "aud:x"


def test_manual_eval_case_level_agreement(tmp_path, monkeypatch):
    import csv

    import evals.manual_eval as me

    monkeypatch.setattr(me, "REPORTS", tmp_path)
    monkeypatch.setattr(me, "SHEET", tmp_path / "manual_eval_sheet.csv")
    (tmp_path / "eval-1.json").write_text(
        json.dumps(
            {
                "report": {
                    "cases": [
                        {
                            "name": "aud:a",
                            "inputs": {
                                "transcript": {"segments": [{"index": 0, "text": "t"}]}
                            },
                            "expected_output": [
                                {
                                    "line_index": 0,
                                    "rule_id": "profanity",
                                    "words": ["d"],
                                }
                            ],
                            "output": [
                                {
                                    "line_index": 0,
                                    "rule_id": "profanity",
                                    "words": ["d"],
                                    "confidence": 0.9,
                                }
                            ],
                            "assertions": {"judge_pass": {"value": True}},
                        },
                        {
                            "name": "aud:b",
                            "inputs": {
                                "transcript": {"segments": [{"index": 0, "text": "t"}]}
                            },
                            "expected_output": [],
                            "output": [
                                {
                                    "line_index": 0,
                                    "rule_id": "drugs",
                                    "words": ["x"],
                                    "confidence": 0.8,
                                }
                            ],
                            "assertions": {"judge_pass": {"value": False}},
                        },
                    ]
                }
            }
        )
    )
    sheet = write_sheet()
    rows = list(csv.DictReader(sheet.open()))
    # judge_verdict now comes from judge_pass.value
    assert rows[0]["judge_verdict"] == "pass"
    assert rows[1]["judge_verdict"] == "fail"
    # grade: case a row correct; case b row wrong
    rows[0]["human_verdict"] = "correct"
    rows[1]["human_verdict"] = "wrong"
    with sheet.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=rows[0].keys())
        w.writeheader()
        w.writerows(rows)
    out = summarize_sheet().read_text()
    # case a agrees (pass==pass), case b agrees too (fail==fail) -> 100%
    assert "100.0%" in out


async def test_judge_receives_rules_and_lines_without_audio_metadata(
    music_transcript, monkeypatch
):
    from dataclasses import fields

    from pydantic_evals.evaluators import EvaluatorContext, LLMJudge

    from evals.run_eval import FlagInputs, TranscriptJudge

    captured = []

    async def capture(self, ctx):
        captured.append(ctx)
        return {"judge_pass": True}

    monkeypatch.setattr(LLMJudge, "evaluate", capture)
    # The context has many telemetry fields unrelated to this evaluator.
    kwargs = {field.name: None for field in fields(EvaluatorContext) if field.init}
    kwargs.update(
        inputs=FlagInputs(music_transcript, [category_rule("profanity")]),
        output=[],
        expected_output=[],
    )
    ctx = EvaluatorContext(**kwargs)
    await TranscriptJudge(rubric="test").evaluate(ctx)
    compact = captured[0].inputs
    assert compact["lines"] == [
        {"index": s.index, "text": s.text} for s in music_transcript.segments
    ]
    assert compact["rules"][0]["id"] == "profanity"
    assert compact["rules"][0]["definition"] == category_rule("profanity").definition
    assert "words" not in compact["lines"][0]
    assert ctx.inputs.transcript is music_transcript
