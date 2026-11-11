"""Modal app `audio-angel-agent-separate`: Spleeter 2stems vocal
separation on one T4. Deploy: `uv run modal deploy modal_app/separate.py`
Call: modal.Function.from_name('audio-angel-agent-separate','separate')
"""

from __future__ import annotations

import modal

MODEL = "spleeter:2stems"
SAMPLE_RATE = 44100
MAX_INPUT_BYTES = 50 * 1024 * 1024
MAX_DURATION_S = 30 * 60

image = (
    modal.Image.from_registry(
        "nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04", add_python="3.10"
    )
    .apt_install("ffmpeg", "libsndfile1")
    .pip_install("spleeter==2.4.2", "numpy==1.23.5")
    .env(
        {
            "MODEL_PATH": "/opt/spleeter-models",
            "TF_FORCE_GPU_ALLOW_GROWTH": "true",
        }
    )
    .run_commands(
        "python -c 'from spleeter.model.provider import ModelProvider; "
        'ModelProvider.default().get("2stems")' + "'"
    )
)

app = modal.App("audio-angel-agent-separate")


@app.function(
    image=image,
    gpu="T4",
    cpu=2,
    memory=8192,
    max_containers=1,
    scaledown_window=60,
    timeout=600,
)
def separate(audio: bytes) -> dict:
    """Split audio bytes into vocals + instrumental FLAC stems.

    Exact port of the Convex lane's chunked loop: 30 s chunks with 2 s
    of discarded context, per-stem shape/finite checks, joint
    stem_scale + headroom gain.
    """
    import subprocess
    import tempfile
    import time
    from pathlib import Path

    import numpy as np
    import tensorflow as tf
    from spleeter.separator import Separator

    if not audio or len(audio) > MAX_INPUT_BYTES:
        raise ValueError("Provide a nonempty audio file no larger than 50 MiB")
    if len(tf.config.list_physical_devices("GPU")) != 1:
        raise RuntimeError("One GPU required")

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        source = root / "source.audio"
        source.write_bytes(audio)
        decoded = subprocess.run(
            [
                "ffmpeg",
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(source),
                "-f",
                "f32le",
                "-acodec",
                "pcm_f32le",
                "-ar",
                str(SAMPLE_RATE),
                "-ac",
                "2",
                "pipe:1",
            ],
            capture_output=True,
            check=True,
        )
        original = np.frombuffer(decoded.stdout, dtype="<f4").reshape(-1, 2).copy()
        duration = len(original) / SAMPLE_RATE
        if len(original) == 0 or not np.isfinite(original).all():
            raise ValueError("Input did not decode into valid finite audio")
        if duration > MAX_DURATION_S:
            raise ValueError("Audio exceeds the 30 minute cap")

        separator = Separator(MODEL, multiprocess=False)
        result = {name: np.zeros_like(original) for name in ("vocals", "accompaniment")}
        # Context on each side is discarded, keeping memory bounded.
        chunk, context = 30 * SAMPLE_RATE, 2 * SAMPLE_RATE
        t = time.perf_counter()
        for start in range(0, len(original), chunk):
            end = min(len(original), start + chunk)
            lo, hi = max(0, start - context), min(len(original), end + context)
            stems = separator.separate(original[lo:hi])
            for name in result:  # noqa: PLC0206 - same key in both dicts
                stem = stems[name]
                if stem.shape != original[lo:hi].shape or not np.isfinite(stem).all():
                    raise ValueError("Invalid stem")
                result[name][start:end] = stem[start - lo : end - lo]
        separation_s = time.perf_counter() - t

        gain = min(
            1.0,
            0.98
            / max(
                0.98,
                float(
                    np.max(np.abs(result["vocals"]) + np.abs(result["accompaniment"]))
                ),
            ),
        )
        # FLAC is integer PCM: scale both stems before export; the
        # renderer applies `gain` after remixing.
        peak = max(
            float(np.max(np.abs(result["vocals"]))),
            float(np.max(np.abs(result["accompaniment"]))),
        )
        stem_scale = min(1.0, 0.98 / max(0.98, peak))
        gain /= stem_scale

        out: dict[str, object] = {}
        for name, key in (("vocals", "vocals"), ("accompaniment", "instrumental")):
            path = root / f"{key}.flac"
            proc = subprocess.run(
                check=False,
                args=[
                    "ffmpeg",
                    "-nostdin",
                    "-y",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "f32le",
                    "-ar",
                    str(SAMPLE_RATE),
                    "-ac",
                    "2",
                    "-i",
                    "pipe:0",
                    str(path),
                ],
                input=np.asarray(result[name] * stem_scale, dtype="<f4").tobytes(),
                capture_output=True,
            )
            if proc.returncode != 0:
                raise RuntimeError(f"ffmpeg stem encode failed: {proc.stderr[-300:]}")
            out[key] = path.read_bytes()
        out.update(
            gain=gain,
            duration_s=duration,
            separation_s=separation_s,
        )
        return out
