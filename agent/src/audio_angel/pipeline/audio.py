"""Audio download + podcast trimming into data/cache/audio/."""

from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
from pathlib import Path

import httpx

from audio_angel.helpers.paths import cache_dir, safe_key
from audio_angel.models import Track
from audio_angel.sources.audius import stream_url
from audio_angel.sources.safe import fetch_bytes


class AudioError(Exception):
    pass


def ffmpeg_path() -> str:
    """Locate ffmpeg or raise a clear error."""
    path = shutil.which("ffmpeg")
    if not path:
        raise AudioError(
            "ffmpeg is not installed or not on PATH; install it to download "
            "and render audio"
        )
    return path


PODCAST_MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024


def podcast_max_seconds() -> int:
    raw = os.environ.get("PODCAST_MAX_MINUTES", "10").strip() or "10"
    return int(float(raw) * 60)


async def download_audio(track: Track, *, client: httpx.AsyncClient) -> Path:
    """Download the track audio to the cache; reuse on cache hit.

    Music resolves the signed Audius stream URL first; podcasts download
    the enclosure URL directly and are trimmed to PODCAST_MAX_MINUTES.
    """
    audio_path = cache_dir("audio") / f"{safe_key(track.source_key)}.mp3"
    if audio_path.exists():
        return audio_path

    if track.kind == "music":
        track_id = (
            track.source_ids.get("audius_track_id") or track.source_key.split(":", 1)[1]
        )
        url = await stream_url(track_id, client=client)
    else:
        url = track.audio_url
        if not url:
            raise AudioError(f"Podcast episode {track.title!r} has no audio enclosure")

    if track.kind == "podcast":
        # Episodes can be 100+ MB; only the first PODCAST_MAX_MINUTES are
        # used, so download a prefix big enough for that at 320 kbps.
        prefix_bytes = min(
            PODCAST_MAX_DOWNLOAD_BYTES, podcast_max_seconds() * 320_000 // 8 + 2_000_000
        )
        data = await fetch_bytes(
            url, client=client, max_bytes=prefix_bytes, truncate=True, timeout=120.0
        )
    else:
        data = await fetch_bytes(url, client=client)

    if track.kind == "podcast":
        ffmpeg = ffmpeg_path()
        raw_path = audio_path.with_suffix(".raw")
        raw_path.write_bytes(data)
        try:
            proc = await asyncio.to_thread(
                subprocess.run,
                [
                    ffmpeg,
                    "-y",
                    "-i",
                    str(raw_path),
                    "-t",
                    str(podcast_max_seconds()),
                    # Re-encode: the source may be AAC/M4A, and a cut-off
                    # prefix can end mid-frame.
                    "-vn",
                    "-acodec",
                    "libmp3lame",
                    "-b:a",
                    "128k",
                    str(audio_path),
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            if proc.returncode != 0:
                raise AudioError(
                    f"ffmpeg failed trimming podcast audio: "
                    f"{proc.stderr.strip()[-300:]}"
                )
        finally:
            raw_path.unlink(missing_ok=True)
    else:
        audio_path.write_bytes(data)
    return audio_path
