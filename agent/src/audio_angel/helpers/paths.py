"""Filesystem locations for cached audio, transcripts, renders and logs."""

from __future__ import annotations

import os
import re
from pathlib import Path

# helpers/ is one level below the package root.
_PACKAGE_ROOT = Path(__file__).resolve().parent.parent


def data_dir() -> Path:
    """Root data directory; overridable via AUDIO_ANGEL_DATA_DIR."""
    override = os.environ.get("AUDIO_ANGEL_DATA_DIR", "").strip()
    if override:
        return Path(override).expanduser().resolve()
    # <agent>/data — two levels up from src/audio_angel/paths.py.
    return _PACKAGE_ROOT.parents[1] / "data"


def cache_dir(kind: str) -> Path:
    """data/cache/<kind>, created on demand."""
    path = data_dir() / "cache" / kind
    path.mkdir(parents=True, exist_ok=True)
    return path


def logs_dir() -> Path:
    """data/logs, created on demand."""
    path = data_dir() / "logs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def safe_key(source_key: str) -> str:
    """Make a source key safe for filenames: aud:abc -> aud_abc."""
    return re.sub(r"[^A-Za-z0-9._-]+", "_", source_key)


def lexicon_path() -> Path:
    """Committed lexicon shipped as package data."""
    return _PACKAGE_ROOT / "data" / "lexicon.jsonl"
