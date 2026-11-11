"""Pipeline orchestration shared by the Streamlit UI (and, later, evals):
prepare downloads + transcribes (cached), analyze flags + plans + logs
the run, render produces the muted mp3.
"""

from __future__ import annotations

from dataclasses import asdict

import httpx
import logfire

from audio_angel.agent.flagger import FlagRunResult, flag_transcript
from audio_angel.config import AgentConfig
from audio_angel.helpers.paths import cache_dir, safe_key
from audio_angel.helpers.telemetry import RunRecord, log_run
from audio_angel.models import MuteInterval, MuteRule, Track, Transcript
from audio_angel.pipeline.audio import download_audio
from audio_angel.pipeline.plan import flags_to_intervals
from audio_angel.pipeline.renderer import render_muted
from audio_angel.pipeline.separation import SeparationError, separate_stems, stems_dir
from audio_angel.pipeline.transcribe import transcribe_audio


async def prepare(
    track: Track,
    *,
    client: httpx.AsyncClient | None = None,
    use_separation: bool | None = None,
    separation_status: dict | None = None,
    separator=None,
) -> Transcript:
    """Download audio, optionally split vocals via Modal Spleeter, and
    return the (cached) transcript.

    `use_separation`: None → VOCAL_SEPARATION env (default: music only).
    On separation failure we fall back to the full mix; the caller can
    inspect `separation_status` ("modal" | "off" | "failed: <msg>",
    "separation_s") — also surfaced to analyze() for the run log.
    """
    if separation_status is not None:
        separation_status.clear()
        separation_status["separation"] = "off"
    own = client is None
    client = client or httpx.AsyncClient()
    try:
        with logfire.span("pipeline.download", source_key=track.source_key):
            audio_path = await download_audio(track, client=client)

        stems = None
        try:
            if use_separation is not False:
                stems = await separate_stems(track, audio_path, separator=separator)
        except SeparationError as exc:
            if separation_status is not None:
                separation_status["separation"] = f"failed: {exc}"
            logfire.warn(
                "separation failed; using full mix",
                source_key=track.source_key,
                error=str(exc),
            )
        if stems is not None:
            if separation_status is not None:
                separation_status["separation"] = "modal"
                separation_status["separation_s"] = stems.separation_s
            with logfire.span(
                "pipeline.transcribe_vocals", source_key=track.source_key
            ):
                return await transcribe_audio(
                    stems.vocals_path.read_bytes(),
                    source_key=track.source_key,
                    kind=track.kind,
                    client=client,
                    audio_source="vocals",
                    content_type="audio/flac",
                )
        with logfire.span("pipeline.transcribe", source_key=track.source_key):
            return await transcribe_audio(
                audio_path.read_bytes(),
                source_key=track.source_key,
                kind=track.kind,
                client=client,
            )
    finally:
        if own:
            await client.aclose()


async def analyze(
    transcript: Transcript,
    track: Track,
    rules: list[MuteRule],
    config: AgentConfig,
    *,
    on_progress=None,
    embedder=None,
    separation_status: dict | None = None,
) -> tuple[FlagRunResult, list[MuteInterval], str]:
    """Run the flagging agent, build mute intervals, log the run.

    Returns (flag result, merged intervals, run_id of the logged run).
    """
    error: str | None = None
    result: FlagRunResult | None = None
    intervals: list[MuteInterval] = []
    run_id_holder: dict[str, str] = {}
    try:
        with logfire.span(
            "pipeline.analyze", source_key=track.source_key, config=config.name
        ):
            result = await flag_transcript(
                transcript,
                rules,
                config,
                on_progress=on_progress,
                embedder=embedder,
            )
        plan = flags_to_intervals(result.flags, transcript)
        intervals = plan.intervals
        result.fallbacks = plan.fallbacks
    except Exception as exc:
        error = str(exc)
        raise
    finally:
        run_id_holder["run_id"] = log_run(
            RunRecord(
                source_key=track.source_key,
                title=track.title,
                kind=track.kind,
                rule_ids=[rule.id for rule in rules],
                config={**asdict(config), "name": config.name},
                n_segments=len(transcript.segments),
                n_flags=len(result.flags) if result else 0,
                n_raw_flags=len(result.raw_flags) if result else 0,
                latency_ms=result.latency_ms if result else 0,
                requests=result.requests if result else 0,
                input_tokens=result.input_tokens if result else 0,
                output_tokens=result.output_tokens if result else 0,
                tool_calls=result.tool_calls if result else {},
                separation=(
                    (separation_status or {}).get("separation")
                    or ("modal" if transcript.audio_source == "vocals" else "off")
                ),
                separation_s=(separation_status or {}).get("separation_s"),
                error=error,
            )
        )["run_id"]
    return result, intervals, run_id_holder["run_id"]


def render(track: Track, intervals: list[MuteInterval]):
    """Render the muted mp3; when cached Spleeter stems exist only the
    vocal stem is muted and the instrumental is mixed back in."""
    audio_path = cache_dir("audio") / f"{safe_key(track.source_key)}.mp3"
    if not audio_path.exists():
        raise FileNotFoundError(
            f"No cached audio for {track.source_key}; run prepare() first"
        )
    stems = None
    directory = stems_dir(track.source_key)
    vocals = directory / "vocals.flac"
    instrumental = directory / "instrumental.flac"
    meta = directory / "meta.json"
    if vocals.exists() and instrumental.exists() and meta.exists():
        import json

        from audio_angel.pipeline.separation import Stems

        data = json.loads(meta.read_text())
        stems = Stems(
            vocals_path=vocals,
            instrumental_path=instrumental,
            gain=data["gain"],
            duration_s=data["duration_s"],
            separation_s=data["separation_s"],
        )
    with logfire.span(
        "pipeline.render",
        source_key=track.source_key,
        intervals=len(intervals),
        stems=stems is not None,
    ):
        return render_muted(audio_path, track.source_key, intervals, stems=stems)
