"""Live end-to-end smoke: real Audius track + real podcast episode
through prepare -> analyze -> render. Needs FIREWORKS_API_KEY and
DEEPGRAM_API_KEY in .env. Usage: uv run python scripts/smoke.py
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from audio_angel import pipeline
from audio_angel.agent.prompts import CATEGORY_DEFINITIONS
from audio_angel.config import AgentConfig
from audio_angel.helpers.telemetry import setup_logfire
from audio_angel.models import category_rule, topic_rule
from audio_angel.sources import audius, podcasts


def _ffprobe_duration(path: Path) -> float:
    out = subprocess.run(
        [
            "ffprobe",
            "-v",
            "quiet",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            str(path),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    return float(out.stdout.strip() or 0)


def _print_result(track, transcript, result, intervals, run_id, rendered):
    print(f"  track: {track.title} — {track.artist}")
    print(f"  duration: {track.duration_ms} ms")
    print(f"  segments: {len(transcript.segments)}")
    print(f"  flags: {len(result.raw_flags)} raw / {len(result.flags)} kept")
    print(f"  fallbacks: {result.fallbacks}")
    print(
        f"  requests: {result.requests}  tokens: {result.input_tokens}+{result.output_tokens}  latency: {result.latency_ms} ms"
    )
    print(f"  tool_calls: {result.tool_calls}")
    print(f"  intervals: {len(intervals)}  run_id: {run_id}")
    print(f"  rendered: {rendered} ({_ffprobe_duration(rendered):.1f}s)")
    for f in result.flags[:10]:
        line = (
            transcript.segments[f.line_index].text[:60]
            if f.line_index < len(transcript.segments)
            else "?"
        )
        print(
            f"    [{f.line_index}] {f.rule_id} {f.words} conf={f.confidence} — {f.reason} | {line}"
        )


async def song() -> None:
    print("=== Audius song ===")
    async with httpx.AsyncClient() as client:
        tracks = await audius.search_tracks("explicit rap", client=client)
        track = next(t for t in tracks if (t.duration_ms or 0) < 4 * 60_000)
        transcript = await pipeline.prepare(track, client=client)
    rules = [
        category_rule(c, label=CATEGORY_DEFINITIONS[c].split(":")[0])
        for c in CATEGORY_DEFINITIONS
    ]
    result, intervals, run_id = await pipeline.analyze(
        transcript, track, rules, AgentConfig()
    )
    rendered = pipeline.render(track, intervals)
    _print_result(track, transcript, result, intervals, run_id, rendered)


async def podcast() -> None:
    print("=== Podcast episode ===")
    os.environ["PODCAST_MAX_MINUTES"] = "2"  # this run only
    async with httpx.AsyncClient() as client:
        shows = await podcasts.search_shows("comedy podcast", client=client)
        show = shows[0]
        print(f"  show: {show.name}")
        _, _, episodes = await podcasts.list_episodes(show.feed_url, client=client)
        episode = next(e for e in episodes if e.audio_url)
        transcript = await pipeline.prepare(episode, client=client)
    rules = [
        category_rule("profanity", label="Profanity"),
        topic_rule("politics"),
    ]
    result, intervals, run_id = await pipeline.analyze(
        transcript, episode, rules, AgentConfig()
    )
    rendered = pipeline.render(episode, intervals)
    _print_result(episode, transcript, result, intervals, run_id, rendered)


async def main() -> None:
    setup_logfire()
    await song()
    await podcast()


if __name__ == "__main__":
    asyncio.run(main())
