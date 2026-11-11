"""Modal Spleeter client: separate a downloaded track into cached
vocals/instrumental FLAC stems via the `audio-angel-agent-separate`
Modal app. Env VOCAL_SEPARATION = music | all | off (default music).
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path

import logfire

from audio_angel.helpers.paths import cache_dir, safe_key
from audio_angel.models import Track

APP_NAME = "audio-angel-agent-separate"
FUNCTION_NAME = "separate"


class SeparationError(Exception):
    pass


@dataclass
class Stems:
    vocals_path: Path
    instrumental_path: Path
    gain: float
    duration_s: float
    separation_s: float


def separation_enabled(track: Track) -> bool:
    """VOCAL_SEPARATION env: 'music' (default), 'all', 'off'."""
    mode = os.environ.get("VOCAL_SEPARATION", "music").strip().lower()
    if mode == "off":
        return False
    if mode == "all":
        return True
    return track.kind == "music"


def modal_configured() -> bool:
    return (
        os.environ.get("MODAL_TOKEN_ID", "").strip()
        and os.environ.get("MODAL_TOKEN_SECRET", "").strip()
    ) or Path.home().joinpath(".modal.toml").exists()


def stems_dir(source_key: str) -> Path:
    return cache_dir("stems") / safe_key(source_key)


def _cache_hit(source_key: str, source_hash: str) -> Stems | None:
    directory = stems_dir(source_key)
    meta_path = directory / "meta.json"
    vocals = directory / "vocals.flac"
    instrumental = directory / "instrumental.flac"
    if not (meta_path.exists() and vocals.exists() and instrumental.exists()):
        return None
    meta = json.loads(meta_path.read_text())
    if meta.get("source_sha256") != source_hash:
        return None
    return Stems(
        vocals_path=vocals,
        instrumental_path=instrumental,
        gain=meta["gain"],
        duration_s=meta["duration_s"],
        separation_s=meta["separation_s"],
    )


async def separate_stems(
    track: Track,
    audio_path: Path,
    *,
    separator=None,
) -> Stems | None:
    """Call the Modal `separate` function (or the injected `separator`
    for tests) and cache stems under data/cache/stems/<safe key>/.

    Returns None when separation doesn't apply to this track/kind;
    raises SeparationError when Modal isn't configured or the call fails.
    """
    if not separation_enabled(track):
        return None
    if not modal_configured():
        raise SeparationError(
            "Modal is not configured: set MODAL_TOKEN_ID/MODAL_TOKEN_SECRET "
            "or run `modal token new` (creates ~/.modal.toml)"
        )
    audio_bytes = audio_path.read_bytes()
    source_hash = hashlib.sha256(audio_bytes).hexdigest()
    hit = _cache_hit(track.source_key, source_hash)
    if hit is not None:
        return hit

    if separator is None:

        async def separator(payload: bytes) -> dict:
            import modal

            fn = modal.Function.from_name(APP_NAME, FUNCTION_NAME)
            return await fn.remote.aio(payload)

    with logfire.span("separate.modal", source_key=track.source_key):
        try:
            out = await separator(audio_bytes)
        except Exception as exc:
            raise SeparationError(f"Modal separation failed: {exc}") from exc

    directory = stems_dir(track.source_key)
    directory.mkdir(parents=True, exist_ok=True)
    vocals = directory / "vocals.flac"
    instrumental = directory / "instrumental.flac"
    vocals.write_bytes(out["vocals"])
    instrumental.write_bytes(out["instrumental"])
    meta = {
        "gain": out["gain"],
        "duration_s": out["duration_s"],
        "separation_s": out["separation_s"],
        "source_sha256": source_hash,
    }
    (directory / "meta.json").write_text(json.dumps(meta))
    return Stems(
        vocals_path=vocals,
        instrumental_path=instrumental,
        gain=out["gain"],
        duration_s=out["duration_s"],
        separation_s=out["separation_s"],
    )
