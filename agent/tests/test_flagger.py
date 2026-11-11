import json
from types import SimpleNamespace

import pytest
from pydantic_ai.exceptions import UnexpectedModelBehavior
from pydantic_ai.messages import ModelResponse, TextPart
from pydantic_ai.models.function import FunctionModel

from audio_angel.agent.flagger import (
    FlagDeps,
    _build_agent,
    _entry_in_line,
    flag_transcript,
    get_context,
    search_lexicon,
    search_transcript,
)
from audio_angel.config import AgentConfig
from audio_angel.kb.lexicon import entry_doc, load_lexicon
from audio_angel.kb.search import build_retriever
from audio_angel.kb.transcript_index import build_transcript_retriever
from audio_angel.models import category_rule, term_rule

RULES = [category_rule("profanity"), term_rule("bazinga")]


def batch_model(payloads):
    """FunctionModel that returns the next canned FlagBatch JSON."""
    queue = list(payloads)

    def fn(messages, info):
        payload = queue.pop(0) if queue else {"flags": []}
        return ModelResponse(
            parts=[TextPart(json.dumps(payload))],
        )

    return FunctionModel(fn)


def deps_for(transcript, *, method="text", embedder=None):
    docs = [entry_doc(e) for e in load_lexicon()]
    return FlagDeps(
        transcript=transcript,
        rules=RULES,
        lexicon=build_retriever(method, docs, embedder=embedder),
        lexicon_docs={d["id"]: d for d in docs},
        transcript_index=build_transcript_retriever(
            transcript, method, embedder=embedder
        ),
        line_lo=0,
        line_hi=len(transcript.segments) - 1,
    )


def test_entry_in_line_token_matching():
    assert _entry_in_line("damn", "this is a Damn, good day")
    assert _entry_in_line("good day", "this is a DAMN good day!")
    assert not _entry_in_line("dammit", "this is a damn good day")
    assert not _entry_in_line("heck", "this is a damn good day")


async def test_flag_transcript_collects_flags_and_usage(music_transcript):
    model = batch_model(
        [
            {
                "flags": [
                    {
                        "line_index": 1,
                        "rule_id": "profanity",
                        "words": ["damn"],
                        "confidence": 0.9,
                        "reason": "swear",
                    },
                    {
                        "line_index": 2,
                        "rule_id": "profanity",
                        "words": ["damn"],
                        "confidence": 0.2,
                        "reason": "low conf",
                    },
                ]
            }
        ]
    )
    result = await flag_transcript(
        music_transcript,
        RULES,
        AgentConfig(tools_enabled=False, min_confidence=0.5),
        model=model,
    )
    assert [f.line_index for f in result.flags] == [1]
    assert len(result.raw_flags) == 2
    assert result.requests == 1
    assert result.latency_ms >= 0
    assert result.tool_calls == {}


async def test_flag_transcript_chunks_and_progress():
    segments = []
    from tests.conftest import make_segment

    for i in range(7):
        segments.append(make_segment(i, f"line {i} words here", i * 1000))
    from audio_angel.models import Transcript

    transcript = Transcript(
        source_key="aud:c", kind="music", duration_ms=8000, segments=segments
    )
    calls = batch_model([{"flags": []}, {"flags": []}, {"flags": []}])
    progress = []
    result = await flag_transcript(
        transcript,
        RULES,
        AgentConfig(tools_enabled=False, chunk_size=3),
        on_progress=lambda d, t: progress.append((d, t)),
        model=calls,
    )
    assert sorted(progress) == [(1, 3), (2, 3), (3, 3)]
    assert result.requests == 3


@pytest.mark.parametrize(
    "bad_flag",
    [
        {
            "line_index": 99,
            "rule_id": "profanity",
            "words": [],
            "confidence": 0.9,
            "reason": "out of chunk",
        },
        {
            "line_index": 1,
            "rule_id": "nonexistent",
            "words": [],
            "confidence": 0.9,
            "reason": "bad rule",
        },
        {
            "line_index": 1,
            "rule_id": "profanity",
            "words": ["zebra"],
            "confidence": 0.9,
            "reason": "word absent",
        },
    ],
)
async def test_validator_retries_then_fails(music_transcript, bad_flag):
    # The model always returns the invalid flag; the validator raises
    # ModelRetry, and the run exhausts retries.
    model = batch_model([{"flags": [bad_flag]}] * 5)
    with pytest.raises(UnexpectedModelBehavior):
        await flag_transcript(
            music_transcript,
            RULES,
            AgentConfig(tools_enabled=False),
            model=model,
        )


async def test_validator_recovers_on_retry(music_transcript):
    model = batch_model(
        [
            {
                "flags": [
                    {
                        "line_index": 99,
                        "rule_id": "profanity",
                        "words": [],
                        "confidence": 0.9,
                        "reason": "bad",
                    }
                ]
            },
            {
                "flags": [
                    {
                        "line_index": 1,
                        "rule_id": "profanity",
                        "words": ["damn"],
                        "confidence": 0.9,
                        "reason": "good",
                    }
                ]
            },
        ]
    )
    result = await flag_transcript(
        music_transcript,
        RULES,
        AgentConfig(tools_enabled=False),
        model=model,
    )
    assert [f.line_index for f in result.flags] == [1]


def test_tools_disabled_registers_no_tools():
    agent = _build_agent(AgentConfig(tools_enabled=False), RULES, "song")
    assert agent._function_toolset.tools == {}
    agent_on = _build_agent(AgentConfig(tools_enabled=True), RULES, "song")
    assert set(agent_on._function_toolset.tools) == {
        "search_lexicon",
        "get_context",
        "search_transcript",
    }


def _ctx(deps):
    # The tools only read ctx.deps, so a stub RunContext is enough.
    return SimpleNamespace(deps=deps)


def test_search_lexicon_tool_shape(music_transcript):
    deps = deps_for(music_transcript)
    hits = search_lexicon(_ctx(deps), "what does molly mean", k=3)
    assert hits
    for hit in hits:
        assert {"id", "term", "variants", "category", "definition", "score"} <= set(hit)
    assert deps.tool_calls["search_lexicon"] == 1


def test_get_context_bounds_and_shape(music_transcript):
    deps = deps_for(music_transcript)
    ctx = _ctx(deps)
    rows = get_context(ctx, 1, radius=2)
    assert [r["index"] for r in rows] == [0, 1, 2]
    # radius capped at 5 and clipped at edges
    rows = get_context(ctx, 0, radius=99)
    assert [r["index"] for r in rows] == [0, 1, 2]
    assert get_context(ctx, 99) == []
    assert deps.tool_calls["get_context"] == 3


def test_search_transcript_tool_shape(music_transcript):
    deps = deps_for(music_transcript)
    hits = search_transcript(_ctx(deps), "damn", k=5)
    indices = {h["index"] for h in hits}
    assert {1, 2} <= indices
    assert all({"index", "text", "score"} <= set(h) for h in hits)
    assert deps.tool_calls["search_transcript"] == 1


def test_tool_budget_returns_hint(music_transcript):
    """After MAX_TOOL_CALLS the tools return a decide-now note instead
    of more retrieval — regression for the 50-request runaway loop."""
    from audio_angel.agent.flagger import MAX_TOOL_CALLS

    deps = deps_for(music_transcript)
    deps.tool_calls["search_lexicon"] = MAX_TOOL_CALLS
    ctx = _ctx(deps)
    assert search_lexicon(ctx, "molly") == [
        {"note": "tool budget reached for this batch — decide from what you have"}
    ]
    assert get_context(ctx, 1) == [
        {"note": "tool budget reached for this batch — decide from what you have"}
    ]
    assert search_transcript(ctx, "damn") == [
        {"note": "tool budget reached for this batch — decide from what you have"}
    ]
    # Below the budget the tools still work.
    deps2 = deps_for(music_transcript)
    assert search_lexicon(_ctx(deps2), "molly", k=1)
