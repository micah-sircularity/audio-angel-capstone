"""Generate draft ground-truth labels for human review.

For each candidate Audius track: prepare (Modal Spleeter vocals ->
Deepgram), skip instrumentals, assign a *random* rule set, run the
flagging agent, and save the flags as labeled_by="draft" under
evals/data/ground_truth_draft/. Evals never read that directory —
drafts exist so a human can open one on the Label page, correct the
flags, and save it as real (human) ground truth.

Usage: uv run python scripts/gen_drafts.py [--n 20] [--seed 7]
"""

from __future__ import annotations

import argparse
import asyncio
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import httpx
from dotenv import load_dotenv

from audio_angel import pipeline
from audio_angel.agent.prompts import CATEGORY_DEFINITIONS
from audio_angel.config import AgentConfig
from audio_angel.ground_truth import (
    ExpectedFlag,
    GroundTruth,
    gt_path,
    save_ground_truth,
)
from audio_angel.models import category_rule, term_rule, topic_rule
from audio_angel.sources import audius
from audio_angel.telemetry import setup_logfire

CATEGORIES = list(CATEGORY_DEFINITIONS)

TERM_POOL = [
    "mischief, violence, brashness",
    "insults and put-downs",
    "drug use or dealing",
    "guns and shooting",
    "disrespect toward women",
    "bragging about money",
]
TOPIC_POOL = [
    "police and crime",
    "partying and alcohol",
    "relationships and breakups",
    "death and dying",
]

# Queries chosen to surface vocal tracks, not beat tapes.
SEARCHES = [
    ("", "Hip-Hop/Rap"),
    ("freestyle", "Hip-Hop/Rap"),
    ("love", "Hip-Hop/Rap"),
    ("street", "Hip-Hop/Rap"),
    ("real", "Hip-Hop/Rap"),
    ("pain", "Hip-Hop/Rap"),
    ("story", "Hip-Hop/Rap"),
    ("", "R&B/Soul"),
    ("heart", "R&B/Soul"),
    ("", "Pop"),
    ("song", "Pop"),
]

SKIP_TITLE = (
    "instrumental",
    "type beat",
    "beat tape",
    "karaoke",
    "lo-fi",
    "lofi",
    "remix)",
)
MIN_SEGMENTS = 4
MIN_WORDS = 40
MAX_DURATION_MS = 8 * 60_000


def random_rules(rng: random.Random):
    rules = [
        category_rule(c, label=CATEGORY_DEFINITIONS[c].split(":")[0])
        for c in rng.sample(CATEGORIES, rng.randint(2, 4))
    ]
    if rng.random() < 0.45:
        rules.append(term_rule(rng.choice(TERM_POOL)))
    if rng.random() < 0.20:
        rules.append(topic_rule(rng.choice(TOPIC_POOL)))
    return rules


async def gather_candidates(client: httpx.AsyncClient, rng: random.Random):
    seen: dict[str, object] = {}
    for query, genre in SEARCHES:
        try:
            for track in await audius.search_tracks(query, client=client, genre=genre):
                title = track.title.lower()
                if any(bad in title for bad in SKIP_TITLE):
                    continue
                if (track.duration_ms or 0) > MAX_DURATION_MS:
                    continue
                seen.setdefault(track.source_key, track)
        except Exception as exc:  # noqa: BLE001
            print(f"  search {query!r}/{genre} failed: {exc}")
    candidates = list(seen.values())
    rng.shuffle(candidates)
    return candidates


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--n", type=int, default=20)
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()

    load_dotenv()
    setup_logfire()
    rng = random.Random(args.seed)

    async with httpx.AsyncClient() as client:
        candidates = await gather_candidates(client, rng)
    print(f"{len(candidates)} candidates after filtering")

    made = 0
    for track in candidates:
        if made >= args.n:
            break
        key = track.source_key
        if gt_path(key, "draft").exists() or gt_path(key, "human").exists():
            continue
        print(f"\n=== {track.title} — {track.artist} ({key})")
        try:
            status: dict = {}
            transcript = await pipeline.prepare(
                track, use_separation=True, separation_status=status
            )
        except Exception as exc:  # noqa: BLE001
            print(f"  prepare failed: {exc}")
            continue
        words = sum(len(s.words) for s in transcript.segments)
        sep = status.get("separation", "?")
        print(
            f"  prepared: {len(transcript.segments)} lines, {words} words, "
            f"separation={sep} ({status.get('separation_s', 0):.0f}s), "
            f"audio_source={transcript.audio_source}"
        )
        if len(transcript.segments) < MIN_SEGMENTS or words < MIN_WORDS:
            print("  skip: too little speech")
            continue

        rules = random_rules(rng)
        config = AgentConfig()
        try:
            result, _intervals, _run_id = await pipeline.analyze(
                transcript, track, rules, config, separation_status=status
            )
        except Exception as exc:  # noqa: BLE001
            print(f"  analyze failed: {exc}")
            continue
        print(
            f"  agent: {len(result.flags)} flags "
            f"({len(result.raw_flags)} raw) in {result.latency_ms / 1000:.0f}s; "
            f"rules: {', '.join(r.id for r in rules)}"
        )

        gt = GroundTruth(
            source_key=key,
            title=track.title,
            artist=track.artist,
            kind=track.kind,
            rules=rules,
            transcript=transcript,
            expected=[
                ExpectedFlag(
                    line_index=f.line_index,
                    rule_id=f.rule_id,
                    words=f.words,
                )
                for f in result.flags
            ],
            labeled_by="draft",
            prefilled_from=config.name,
            notes=f"gen_drafts seed={args.seed} — needs human review",
        )
        path = save_ground_truth(gt)
        made += 1
        print(f"  draft {made}/{args.n} -> {path.name}")

    print(f"\nDone: {made} drafts in evals/data/ground_truth_draft/")


if __name__ == "__main__":
    asyncio.run(main())
