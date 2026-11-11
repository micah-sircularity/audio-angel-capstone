"""Render muted audio with ffmpeg: a volume=0 filter gated by
between(t, start, end) expressions, one per mute interval.
"""

from __future__ import annotations

import hashlib
import shutil
import subprocess
from pathlib import Path
from typing import TYPE_CHECKING

from audio_angel.audio import ffmpeg_path
from audio_angel.models import MuteInterval
from audio_angel.paths import cache_dir, safe_key

if TYPE_CHECKING:
    from audio_angel.separation import Stems


class RenderError(Exception):
    pass


def _volume_filter(intervals: list[MuteInterval]) -> str:
    between = "+".join(
        f"between(t,{i.start_ms / 1000:.3f},{i.end_ms / 1000:.3f})" for i in intervals
    )
    return f"volume=enable='{between}':volume=0"


def render_muted(
    source_audio: Path,
    source_key: str,
    intervals: list[MuteInterval],
    stems: Stems | None = None,
) -> Path:
    """Write the muted mp3 to data/cache/renders; reuse by content hash.

    With `stems` (Spleeter separation) only the vocal stem is muted and
    the instrumental is mixed back in via amix, then the separation
    `gain` is applied. Without stems the full mix is muted.
    """
    stem_tag = "vocals" if stems else "mix"
    digest = hashlib.sha256(
        (
            f"{stem_tag}|" + "|".join(f"{i.start_ms}-{i.end_ms}" for i in intervals)
        ).encode()
    ).hexdigest()[:16]
    out = cache_dir("renders") / f"{safe_key(source_key)}-{digest}.mp3"
    if out.exists():
        return out
    if not intervals and stems is None:
        shutil.copy(source_audio, out)
        return out
    ffmpeg = ffmpeg_path()
    if stems is not None:
        # [0] vocals stem muted on intervals, [1] instrumental mixed in,
        # then gain restores the pre-stem_scale level. Empty intervals
        # still run the mix graph so A/B comparisons share one gain.
        vocal = (
            f"[0:a]{_volume_filter(intervals)}[v];" if intervals else "[0:a]acopy[v];"
        )
        graph = vocal + f"[v][1:a]amix=inputs=2:normalize=0,volume={stems.gain:.6f}[a]"
        cmd = [
            ffmpeg,
            "-y",
            "-i",
            str(stems.vocals_path),
            "-i",
            str(stems.instrumental_path),
            "-filter_complex",
            graph,
            "-map",
            "[a]",
            str(out),
        ]
    else:
        cmd = [
            ffmpeg,
            "-y",
            "-i",
            str(source_audio),
            "-af",
            _volume_filter(intervals),
            str(out),
        ]
    proc = subprocess.run(
        cmd,
        check=False,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0 or not out.exists():
        raise RenderError(f"ffmpeg render failed: {proc.stderr.strip()[-400:]}")
    return out
