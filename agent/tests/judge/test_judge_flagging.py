"""Judge tests: run the REAL flagging agent (default config) on
hand-written fixtures and assert the LLM judge passes plus the
deterministic pair metrics hit their targets. Requires
FIREWORKS_API_KEY; deselected by default (marker `judge`)."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

pytestmark = [
    pytest.mark.judge,
    pytest.mark.skipif(
        not os.environ.get("FIREWORKS_API_KEY", "").strip(),
        reason="FIREWORKS_API_KEY not set",
    ),
]

from pydantic_evals.evaluators import LLMJudge
from pydantic_evals.evaluators.context import EvaluatorContext

from audio_angel.agent.flagger import flag_transcript
from audio_angel.config import GLM_FLASH, AgentConfig
from audio_angel.helpers.ground_truth import ExpectedFlag
from audio_angel.models import (
    Segment,
    Transcript,
    Word,
    category_rule,
    topic_rule,
)
from evals.judge import JUDGE_RUBRIC
from evals.metrics import case_metrics


def _transcript(kind: str, lines: list[str]) -> Transcript:
    segments = []
    for index, text in enumerate(lines):
        start = index * 3000
        words = [
            Word(start_ms=start + i * 300, end_ms=start + i * 300 + 280, text=t)
            for i, t in enumerate(text.split())
        ]
        segments.append(
            Segment(
                index=index,
                start_ms=start,
                end_ms=words[-1].end_ms,
                text=text,
                words=words,
            )
        )
    return Transcript(
        source_key=f"test:{kind}",
        kind=kind,  # type: ignore[arg-type]
        duration_ms=segments[-1].end_ms + 500,
        segments=segments,
    )


A = _transcript(
    "music",
    [
        "I woke up early and the sun was out",
        "this traffic is so fucking slow",
        "we sang along to every song",
        "she said what the hell are you doing",
    ],
)
A_EXPECTED = [
    ExpectedFlag(line_index=1, rule_id="profanity", words=["fucking"]),
    ExpectedFlag(line_index=3, rule_id="profanity", words=["hell"]),
]

B = _transcript(
    "music",
    [
        "we climbed so high up on the mountain",
        "rolling up a blunt before the show",
        "my grandma bakes the best bread",
    ],
)
B_EXPECTED = [ExpectedFlag(line_index=1, rule_id="drugs", words=["blunt"])]

C = _transcript(
    "podcast",
    [
        "welcome back to the show everybody",
        "today we're talking about the election results",
        "the candidate's speech went long",
        "anyway let's get to listener questions about gardening",
    ],
)
C_RULE = topic_rule("politics")
C_EXPECTED = [
    ExpectedFlag(line_index=1, rule_id=C_RULE.id, words=[]),
    ExpectedFlag(line_index=2, rule_id=C_RULE.id, words=[]),
]


def _ctx(inputs, expected, output):
    return EvaluatorContext(
        name="judge-test",
        inputs=inputs,
        metadata=None,
        expected_output=expected,
        output=output,
        duration=0.0,
        _span_tree=None,
        attributes={},
        metrics={},
    )


async def _run_and_judge(transcript, rules, expected, min_recall: float):
    result = await flag_transcript(transcript, rules, AgentConfig())
    metrics = case_metrics(result.flags, expected)
    judge = LLMJudge(
        rubric=JUDGE_RUBRIC,
        model=GLM_FLASH,
        include_input=True,
        include_expected_output=True,
    )
    verdict = await judge.evaluate(
        _ctx(
            {
                "transcript": transcript.model_dump(),
                "rules": [r.model_dump() for r in rules],
            },
            expected,
            [f.model_dump() for f in result.flags],
        )
    )
    return metrics, verdict


async def test_case_a_profanity():
    metrics, verdict = await _run_and_judge(
        A, [category_rule("profanity")], A_EXPECTED, 1.0
    )
    assert metrics.f1 == 1.0, f"F1={metrics.f1}"
    assert verdict


async def test_case_b_drugs():
    metrics, verdict = await _run_and_judge(
        B, [category_rule("drugs")], B_EXPECTED, 1.0
    )
    assert metrics.f1 == 1.0, f"F1={metrics.f1}"
    assert verdict


async def test_case_c_topic_politics():
    metrics, verdict = await _run_and_judge(C, [C_RULE], C_EXPECTED, 1.0)
    assert metrics.recall == 1.0, f"recall={metrics.recall}"
    assert verdict
