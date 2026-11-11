"""One-T4 Spleeter experiment. Run with `modal run`, not `modal deploy`."""
from __future__ import annotations

import io
import json
from pathlib import Path
import statistics
import time
import zipfile

import modal

MODEL = "spleeter:2stems"
SAMPLE_RATE = 44100
DEMO_URL = "https://raw.githubusercontent.com/deezer/spleeter/master/audio_example.mp3"
MAX_INPUT_BYTES = 25 * 1024 * 1024

image = (
    modal.Image.from_registry(
        "nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04", add_python="3.10"
    )
    .apt_install("ffmpeg", "libsndfile1")
    .pip_install("spleeter==2.4.2", "numpy==1.23.5", "nvidia-ml-py==12.560.30")
    .env({"MODEL_PATH": "/opt/spleeter-models", "TF_FORCE_GPU_ALLOW_GROWTH": "true"})
    .run_commands(
        "python -c 'from spleeter.model.provider import ModelProvider; "
        'ModelProvider.default().get("2stems")' + "'"
    )
)
app = modal.App("audio-angel-spleeter-test")


def replace_window(original, instrumental, start_s, end_s, sample_rate=SAMPLE_RATE):
    """Use this recording's instrumental only inside an explicitly chosen window."""
    import numpy as np

    if original.shape != instrumental.shape or original.ndim != 2:
        raise ValueError("Original and instrumental must have identical frame/channel shapes")
    if not 0 <= start_s < end_s <= len(original) / sample_rate:
        raise ValueError("Preview window must lie inside the decoded clip")
    start, end = round(start_s * sample_rate), round(end_s * sample_rate)
    if end <= start:
        raise ValueError("Preview interval must span at least one audio sample")
    mask = np.zeros(len(original), dtype=np.float32)
    mask[start:end] = 1
    fade = min(round(0.01 * sample_rate), (end - start) // 2)
    if fade:
        ramp = (1 - np.cos(np.linspace(0, np.pi, fade, dtype=np.float32))) / 2
        mask[start:start + fade] = ramp
        mask[end - fade:end] = ramp[::-1]
    return original * (1 - mask[:, None]) + instrumental * mask[:, None]


def stats(values):
    return {"samples_s": values, "median_s": statistics.median(values),
            "min_s": min(values), "max_s": max(values)}


@app.function(
    image=image, gpu="T4", cpu=2, memory=8192, max_containers=1,
    scaledown_window=2, timeout=600, retries=0,
)
def benchmark(audio_bytes: bytes, seconds: float, repeats: int,
              mute_start: float, mute_end: float):
    import subprocess
    import tempfile
    import threading
    from importlib.metadata import version

    if not audio_bytes or len(audio_bytes) > MAX_INPUT_BYTES:
        raise ValueError("Provide a nonempty audio file no larger than 25 MiB")
    if not 1 <= seconds <= 120 or not 1 <= repeats <= 10:
        raise ValueError("Clip must be 1–120 seconds; repeats 1–10")

    request_started = time.perf_counter()
    started = time.perf_counter()
    import numpy as np
    import tensorflow as tf
    import pynvml
    from spleeter.separator import Separator
    import_s = time.perf_counter() - started
    gpus = tf.config.list_physical_devices("GPU")
    if len(gpus) != 1 or not tf.test.is_built_with_cuda():
        raise RuntimeError("This test requires exactly one TensorFlow CUDA GPU")

    pynvml.nvmlInit()
    handle = pynvml.nvmlDeviceGetHandleByIndex(0)
    gpu_name = pynvml.nvmlDeviceGetName(handle)
    if isinstance(gpu_name, bytes):
        gpu_name = gpu_name.decode()
    samples = []
    sampling_errors = []
    stop = threading.Event()

    def sample_gpu():
        while not stop.is_set():
            try:
                mem = pynvml.nvmlDeviceGetMemoryInfo(handle)
                util = pynvml.nvmlDeviceGetUtilizationRates(handle)
                samples.append((mem.used, util.gpu))
            except Exception as error:
                sampling_errors.append(type(error).__name__)
            stop.wait(0.05)

    sampler = threading.Thread(target=sample_gpu, daemon=True)
    sampler.start()
    try:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "source.audio"
            source.write_bytes(audio_bytes)
            started = time.perf_counter()
            decoded = subprocess.run([
                "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
                "-i", str(source), "-t", str(seconds), "-f", "f32le",
                "-acodec", "pcm_f32le", "-ar", str(SAMPLE_RATE), "-ac", "2", "pipe:1",
            ], capture_output=True, check=True)
            original = np.frombuffer(decoded.stdout, dtype="<f4").reshape(-1, 2).copy()
            decode_s = time.perf_counter() - started
            duration = len(original) / SAMPLE_RATE
            if len(original) == 0 or not np.isfinite(original).all():
                raise ValueError("Input did not decode into valid finite audio")
            if float(np.max(np.abs(original))) == 0:
                raise ValueError("Silent input is not a useful separation benchmark")
            if not 0 <= mute_start < mute_end <= duration:
                raise ValueError("Preview interval exceeds the decoded duration")

            started = time.perf_counter()
            separator = Separator(MODEL, multiprocess=False)
            construct_s = time.perf_counter() - started
            timings = []
            validated_runs = 0
            stems = None
            for _ in range(repeats + 1):
                started = time.perf_counter()
                stems = separator.separate(original)
                # Access arrays and validate after each timed call. No lazy work is timed as done.
                elapsed = time.perf_counter() - started
                for name in ("vocals", "accompaniment"):
                    if name not in stems or stems[name].shape != original.shape:
                        raise RuntimeError("Stem is absent or its frame/channel count changed")
                    if not np.isfinite(stems[name]).all():
                        raise RuntimeError("Model returned non-finite audio")
                if np.max(np.abs(stems["accompaniment"])) == 0:
                    raise RuntimeError("Model returned a silent instrumental")
                timings.append(elapsed)
                validated_runs += 1

            started = time.perf_counter()
            instrumental = stems["accompaniment"]
            preview = replace_window(original, instrumental, mute_start, mute_end)
            before = round(mute_start * SAMPLE_RATE)
            after = round(mute_end * SAMPLE_RATE)
            if not np.array_equal(preview[:before], original[:before]):
                raise RuntimeError("Preview changed audio before the chosen interval")
            if not np.array_equal(preview[after:], original[after:]):
                raise RuntimeError("Preview changed audio after the chosen interval")
            mix_s = time.perf_counter() - started
            # Float WAV avoids accidental clipping/normalization or lossy codec delays.
            files = {}
            export_started = time.perf_counter()
            for name, data in [("original", original), ("instrumental", instrumental),
                               ("vocals", stems["vocals"]), ("manual-window-preview", preview)]:
                path = Path(tmp) / f"{name}.wav"
                subprocess.run([
                    "ffmpeg", "-nostdin", "-y", "-hide_banner", "-loglevel", "error",
                    "-f", "f32le", "-ar", str(SAMPLE_RATE), "-ac", "2", "-i", "pipe:0",
                    "-c:a", "pcm_f32le", str(path),
                ], input=np.asarray(data, dtype="<f4").tobytes(), capture_output=True, check=True)
                files[path.name] = path.read_bytes()
            export_s = time.perf_counter() - export_started

        peak_memory = max((x[0] for x in samples), default=None)
        max_util = max((x[1] for x in samples), default=0)
        report = {
            "model": MODEL, "gpu": gpu_name, "gpu_count": len(gpus),
            "versions": {name: version(name) for name in ("spleeter", "tensorflow", "numpy")},
            "clip_duration_s": duration, "requested_clip_s": seconds,
            "sample_rate_hz": SAMPLE_RATE, "frames": len(original), "input_bytes": len(audio_bytes),
            "tensorflow_import_s": import_s, "decode_s": decode_s,
            "separator_construct_s": construct_s, "first_separation_s": timings[0],
            "repeat_separations": stats(timings[1:]),
            "repeat_real_time_factor": statistics.median(timings[1:]) / duration,
            "repeat_speed_x": duration / statistics.median(timings[1:]),
            "manual_mix_s": mix_s, "export_four_wavs_s": export_s,
            "validated_separations": validated_runs, "failed_separations": 0,
            "sampled_peak_device_vram_mib": None if peak_memory is None else peak_memory / 2**20,
            "sampled_max_gpu_util_percent": max_util,
            "gpu_memory_samples": len(samples), "gpu_sampling_errors": sampling_errors,
            "manual_preview_window_s": [mute_start, mute_end],
            "worker_elapsed_before_zip_s": time.perf_counter() - request_started,
            "limitations": [
                "First call excludes container allocation/image build; local wall time includes remote overhead.",
                "Repeat timings include all work inside Spleeter's public separate() API, including any per-call graph/weight setup.",
                "Device VRAM is sampled reserved/used memory, not a proven minimum VRAM requirement.",
                "50 ms sampling can miss brief peaks; GPU visibility/utilization does not prove every operation runs on GPU.",
                "Frame-count validation is not an acoustic alignment or vocal-leakage listening test.",
                "Preview uses a manually selected interval; no ASR, profanity detection or automatic word removal.",
                "This demo may be shorter than a full song; do not extrapolate linearly without a duration sweep.",
            ],
        }
        files["report.json"] = json.dumps(report, indent=2).encode()
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as output:
            for name, content in files.items():
                output.writestr(name, content)
        return archive.getvalue()
    finally:
        stop.set()
        sampler.join(timeout=2)
        pynvml.nvmlShutdown()


@app.local_entrypoint()
def main(file: str = "", output: str = "tools/spleeter/output", seconds: float = 30,
         repeats: int = 5, mute_start: float = 5, mute_end: float = 6):
    import urllib.request

    if not 1 <= seconds <= 120 or not 1 <= repeats <= 10:
        raise ValueError("Clip must be 1–120 seconds; repeats 1–10")
    if not 0 <= mute_start < mute_end <= seconds:
        raise ValueError("Choose a preview window inside the requested clip")
    if file:
        path = Path(file).expanduser()
        if path.stat().st_size > MAX_INPUT_BYTES:
            raise ValueError("Input exceeds the 25 MiB test cap")
        audio = path.read_bytes()
        source_label = path.name
    else:
        with urllib.request.urlopen(DEMO_URL, timeout=60) as response:
            audio = response.read(MAX_INPUT_BYTES + 1)
        source_label = DEMO_URL
    if not audio or len(audio) > MAX_INPUT_BYTES:
        raise ValueError("Input must be nonempty and at most 25 MiB")

    # New directory per attempt: preserve previous audio and benchmark results.
    from datetime import datetime, timezone
    target = Path(output) / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    target.mkdir(parents=True, exist_ok=False)
    started = time.perf_counter()
    archive = benchmark.remote(audio, seconds, repeats, mute_start, mute_end)
    local_wall_s = time.perf_counter() - started
    with zipfile.ZipFile(io.BytesIO(archive)) as result:
        expected = {"original.wav", "instrumental.wav", "vocals.wav", "manual-window-preview.wav", "report.json"}
        if set(result.namelist()) != expected:
            raise RuntimeError("Unexpected remote output files")
        for name in expected:
            (target / name).write_bytes(result.read(name))
    report = json.loads((target / "report.json").read_text())
    report.update(local_remote_call_wall_s=local_wall_s, source=source_label)
    (target / "report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    print(f"Audio and timing report: {target.resolve()}")


def self_test():
    import numpy as np

    rate = 1000
    original = np.ones((rate * 3, 2), dtype=np.float32)
    instrumental = original * 0.25
    result = replace_window(original, instrumental, 1, 2, sample_rate=rate)
    assert np.array_equal(result[:rate], original[:rate])
    assert np.array_equal(result[rate * 2:], original[rate * 2:])
    assert np.allclose(result[rate + 20:rate * 2 - 20], instrumental[rate + 20:rate * 2 - 20])
    assert np.isfinite(result).all() and result.shape == original.shape
    for start, end in [(-1, 1), (2, 1), (1, 4)]:
        try:
            replace_window(original, instrumental, start, end, sample_rate=rate)
        except ValueError:
            pass
        else:
            raise AssertionError("Invalid interval accepted")
    print("Local preview checks passed; no GPU or Modal call was made.")


if __name__ == "__main__":
    import sys
    if sys.argv[1:] != ["--self-test"]:
        raise SystemExit("Use modal run tools/spleeter/modal_test.py, or --self-test")
    self_test()
