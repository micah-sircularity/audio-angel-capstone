"""The flagging agent: a Pydantic AI agent (Fireworks GLM 5.3 Flash)
that reviews chunks of transcript lines against the listener's mute
rules and returns structured flags. Three retrieval/context tools are
registered only when config.tools_enabled.
"""

from __future__ import annotations

import asyncio
import re
import time
import unicodedata
from collections import Counter
from dataclasses import dataclass, field

import logfire
from pydantic_ai import Agent, ModelRetry, RunContext
from pydantic_ai.output import NativeOutput
from pydantic_ai.tools import Tool

from audio_angel.agent.prompts import render_batch, render_instructions
from audio_angel.config import AgentConfig
from audio_angel.kb.lexicon import entry_doc, load_lexicon
from audio_angel.kb.search import Doc, Embedder, Retriever, build_retriever
from audio_angel.kb.transcript_index import build_transcript_retriever
from audio_angel.models import FlagBatch, LineFlag, MuteRule, Transcript

_MAX_CONTEXT_RADIUS = 5
# Per-chunk tool budget: beyond it tools return a "decide now" hint so
# a model that keeps looking things up still produces output.
MAX_TOOL_CALLS = 10


def _budget_exceeded(deps: FlagDeps) -> bool:
    return sum(deps.tool_calls.values()) >= MAX_TOOL_CALLS


_BUDGET_NOTE = "tool budget reached for this batch — decide from what you have"


@dataclass
class FlagDeps:
    """Runtime deps for one chunk run: what the tools can see."""

    transcript: Transcript
    rules: list[MuteRule]
    lexicon: Retriever | None
    lexicon_docs: dict[str, Doc]
    transcript_index: Retriever | None
    line_lo: int
    line_hi: int
    tool_calls: Counter = field(default_factory=Counter)


@dataclass
class FlagRunResult:
    """Aggregated output of flag_transcript over all chunks."""

    flags: list[LineFlag]
    raw_flags: list[LineFlag]
    requests: int
    input_tokens: int
    output_tokens: int
    latency_ms: int
    tool_calls: dict[str, int]
    # How many flags fell back to whole-line mutes (set by pipeline/plan).
    fallbacks: int = 0


def _tokens(text: str) -> list[str]:
    """Case/punctuation-insensitive tokens (letters+digits, ' removed)."""
    normalized = (
        unicodedata.normalize("NFKC", text)
        .lower()
        .replace("\u2019", "")
        .replace("'", "")
    )
    return re.findall(r"[^\W_]+", normalized)


def _entry_in_line(entry: str, line: str) -> bool:
    """True when the entry's tokens occur as a consecutive run in line."""
    entry_tokens = _tokens(entry)
    line_tokens = _tokens(line)
    if not entry_tokens:
        return False
    n = len(entry_tokens)
    return any(
        line_tokens[i : i + n] == entry_tokens for i in range(len(line_tokens) - n + 1)
    )


# ---------- tools (module-level so tests can call them with stub ctx) ----------


def search_lexicon(ctx: RunContext[FlagDeps], query: str, k: int = 5) -> list[dict]:
    """Look up a word or phrase in the profanity/slang lexicon.

    Use this when a line might contain slang, a euphemism or a censored
    spelling and you are not sure what it means. Returns matching
    entries with their category and a definition that says when the
    term is NOT offensive.
    """
    ctx.deps.tool_calls["search_lexicon"] += 1
    if ctx.deps.lexicon is None or _budget_exceeded(ctx.deps):
        return [{"note": _BUDGET_NOTE}]
    hits = ctx.deps.lexicon.search(query, k)
    return [
        {
            "id": doc_id,
            "term": doc.get("term"),
            "variants": doc.get("variants"),
            "category": doc.get("category"),
            "definition": doc.get("definition"),
            "score": round(score, 4),
        }
        for doc_id, score in hits
        if (doc := ctx.deps.lexicon_docs.get(doc_id)) is not None
    ]


def get_context(
    ctx: RunContext[FlagDeps], line_index: int, radius: int = 2
) -> list[dict]:
    """Return neighbouring transcript lines around line_index.

    Use this when a line is ambiguous on its own (a pronoun, a double
    meaning, a quote). Radius is capped at 5 lines each way and clipped
    at the transcript edges.
    """
    ctx.deps.tool_calls["get_context"] += 1
    if _budget_exceeded(ctx.deps):
        return [{"note": _BUDGET_NOTE}]
    segments = ctx.deps.transcript.segments
    radius = max(0, min(radius, _MAX_CONTEXT_RADIUS))
    by_index = {s.index: s for s in segments}
    if line_index not in by_index:
        return []
    return [
        {"index": s.index, "text": s.text}
        for s in segments
        if abs(s.index - line_index) <= radius
    ]


def search_transcript(ctx: RunContext[FlagDeps], query: str, k: int = 5) -> list[dict]:
    """Search every line of this transcript for a topic or phrase.

    Use this for topic rules: find where the topic comes up anywhere in
    the track, then judge each line on its own. Returns matching lines
    with a relevance score.
    """
    ctx.deps.tool_calls["search_transcript"] += 1
    if ctx.deps.transcript_index is None or _budget_exceeded(ctx.deps):
        return [{"note": _BUDGET_NOTE}]
    hits = ctx.deps.transcript_index.search(query, k)
    by_index = {s.index: s for s in ctx.deps.transcript.segments}
    results: list[dict] = []
    seen: set[int] = set()
    for doc_id, score in hits:
        try:
            index = int(doc_id.split(":", 1)[1])
        except (IndexError, ValueError):
            continue
        segment = by_index.get(index)
        if segment is None or index in seen:
            continue
        seen.add(index)
        results.append({"index": index, "text": segment.text, "score": round(score, 4)})
    return results


TOOLS = [search_lexicon, get_context, search_transcript]


def _budget_prepare(ctx, tool_def):
    """Hide the tool once the chunk's budget is spent — the model then
    has no choice but to emit its flags (a hint alone gets ignored)."""
    return None if _budget_exceeded(ctx.deps) else tool_def


BUDGET_TOOLS = [Tool(f, prepare=_budget_prepare) for f in TOOLS]


def _build_agent(
    config: AgentConfig,
    rules: list[MuteRule],
    media_kind: str,
) -> Agent[FlagDeps, FlagBatch]:
    instructions = render_instructions(
        config.prompt_version,  # type: ignore[arg-type]
        [(rule.id, rule.definition) for rule in rules],
        media_kind,  # type: ignore[arg-type]
    )
    agent: Agent[FlagDeps, FlagBatch] = Agent(
        config.model,
        output_type=NativeOutput(FlagBatch),
        deps_type=FlagDeps,
        instructions=instructions,
        tools=BUDGET_TOOLS if config.tools_enabled else [],
        retries={"output": 2},
    )

    @agent.output_validator
    def validate_batch(ctx: RunContext[FlagDeps], batch: FlagBatch) -> FlagBatch:
        """Drop-or-retry: invalid flags make the whole batch retry."""
        rule_ids = {rule.id for rule in ctx.deps.rules}
        by_index = {s.index: s for s in ctx.deps.transcript.segments}
        kept: list[LineFlag] = []
        seen: set[tuple[int, str]] = set()
        for flag in batch.flags:
            if not (ctx.deps.line_lo <= flag.line_index <= ctx.deps.line_hi):
                raise ModelRetry(
                    f"line_index {flag.line_index} is outside this batch's "
                    f"lines [{ctx.deps.line_lo}, {ctx.deps.line_hi}]; only "
                    "flag lines you were given."
                )
            if flag.rule_id not in rule_ids:
                raise ModelRetry(
                    f"rule_id {flag.rule_id!r} is not one of the rules; "
                    f"use only: {sorted(rule_ids)}."
                )
            segment = by_index[flag.line_index]
            # Accept a match in either the raw segment text or the
            # timestamped words joined together: smart_format punctuation
            # can differ between them, and the planner maps to word spans.
            words_text = " ".join(w.text for w in segment.words)
            for word in flag.words:
                if not _entry_in_line(word, segment.text) and not _entry_in_line(
                    word, words_text
                ):
                    raise ModelRetry(
                        f"word {word!r} does not occur in line "
                        f"{flag.line_index} ({segment.text!r}); copy the "
                        "offending words exactly as they appear."
                    )
            key = (flag.line_index, flag.rule_id)
            if key not in seen:
                seen.add(key)
                kept.append(flag)
        return FlagBatch(flags=kept)

    return agent


async def flag_transcript(
    transcript: Transcript,
    rules: list[MuteRule],
    config: AgentConfig,
    *,
    on_progress=None,
    embedder: Embedder | None = None,
    model=None,
) -> FlagRunResult:
    """Flag every chunk of the transcript concurrently (semaphore 4).

    Returns flags filtered to confidence >= config.min_confidence plus
    the raw pre-threshold flags (phase-2 threshold tuning re-scores
    those), aggregated token usage, wall latency and per-tool counts.
    `model` overrides the model for tests.
    """
    started = time.monotonic()
    segments = transcript.segments
    media_kind = "song" if transcript.kind == "music" else "podcast"

    lexicon_retriever: Retriever | None = None
    lexicon_docs: dict[str, Doc] = {}
    transcript_retriever: Retriever | None = None
    if config.tools_enabled:
        entries = load_lexicon()
        docs = [entry_doc(e) for e in entries]
        lexicon_docs = {d["id"]: d for d in docs}
        lexicon_retriever = build_retriever(
            config.search_method, docs, embedder=embedder
        )
        transcript_retriever = build_transcript_retriever(
            transcript, config.search_method, embedder=embedder
        )

    if model is not None:
        config = AgentConfig(
            model=model,  # type: ignore[arg-type]
            prompt_version=config.prompt_version,
            chunk_size=config.chunk_size,
            search_method=config.search_method,
            min_confidence=config.min_confidence,
            tools_enabled=config.tools_enabled,
        )
    agent = _build_agent(config, rules, media_kind)
    chunks = [
        segments[i : i + config.chunk_size]
        for i in range(0, len(segments), config.chunk_size)
    ]
    semaphore = asyncio.Semaphore(4)
    progress = {"done": 0}

    async def run_chunk(chunk) -> tuple[list[LineFlag], object, Counter]:
        if not chunk:
            return [], None, Counter()
        lo, hi = chunk[0].index, chunk[-1].index
        deps = FlagDeps(
            transcript=transcript,
            rules=rules,
            lexicon=lexicon_retriever,
            lexicon_docs=lexicon_docs,
            transcript_index=transcript_retriever,
            line_lo=lo,
            line_hi=hi,
        )
        prompt = render_batch([(s.index, s.text) for s in chunk])
        async with semaphore:
            with logfire.span(
                "flagger.chunk", line_lo=lo, line_hi=hi, lines=len(chunk)
            ):
                result = await agent.run(prompt, deps=deps)
        progress["done"] += 1
        if on_progress is not None:
            on_progress(progress["done"], len(chunks))
        return result.output.flags, result.usage, deps.tool_calls

    chunk_results = await asyncio.gather(*(run_chunk(c) for c in chunks))

    raw_flags = [flag for flags, _, _ in chunk_results for flag in flags]
    flags = [f for f in raw_flags if f.confidence >= config.min_confidence]
    tool_calls: Counter = Counter()
    requests = input_tokens = output_tokens = 0
    for _, usage, calls in chunk_results:
        if usage is not None:
            requests += usage.requests
            input_tokens += usage.input_tokens
            output_tokens += usage.output_tokens
        tool_calls.update(calls)

    return FlagRunResult(
        flags=flags,
        raw_flags=raw_flags,
        requests=requests,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        latency_ms=round((time.monotonic() - started) * 1000),
        tool_calls=dict(tool_calls),
    )
