"""Separation client + pipeline/render/plan integration (Modal stubbed)."""

from pathlib import Path

import pytest

from audio_angel import pipeline
from audio_angel.models import LineFlag, MuteInterval, Segment, Track, Transcript, Word
from audio_angel.plan import flags_to_intervals
from audio_angel.render import render_muted
from audio_angel.separation import (
    SeparationError,
    Stems,
    separate_stems,
    separation_enabled,
    stems_dir,
)

MUSIC = Track(
    source_key="aud:sep",
    kind="music",
    title="T",
    artist="A",
    duration_ms=1000,
    audio_url="https://x/a.mp3",
)
POD = MUSIC.model_copy(update={"kind": "podcast", "source_key": "pod:sep"})


def _fake_out():
    return {
        "vocals": b"flac-v",
        "instrumental": b"flac-i",
        "gain": 0.9,
        "duration_s": 3.0,
        "separation_s": 1.2,
    }


def test_separation_enabled_modes(monkeypatch):
    monkeypatch.delenv("VOCAL_SEPARATION", raising=False)
    assert separation_enabled(MUSIC) is True  # default = music only
    assert separation_enabled(POD) is False
    monkeypatch.setenv("VOCAL_SEPARATION", "all")
    assert separation_enabled(POD) is True
    monkeypatch.setenv("VOCAL_SEPARATION", "off")
    assert separation_enabled(MUSIC) is False


def test_modal_unconfigured_raises(monkeypatch, tmp_path):
    monkeypatch.delenv("MODAL_TOKEN_ID", raising=False)
    monkeypatch.delenv("MODAL_TOKEN_SECRET", raising=False)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)  # no .modal.toml
    audio = tmp_path / "a.mp3"
    audio.write_bytes(b"x")
    with pytest.raises(SeparationError, match="Modal is not configured"):
        # run the coroutine
        import asyncio

        asyncio.run(separate_stems(MUSIC, audio))


async def test_stems_cache_hit_skips_modal(monkeypatch, tmp_path):
    monkeypatch.setenv("MODAL_TOKEN_ID", "id")
    monkeypatch.setenv("MODAL_TOKEN_SECRET", "sec")
    audio = tmp_path / "a.mp3"
    audio.write_bytes(b"audio-bytes")
    calls = []

    async def sep(payload: bytes):
        calls.append(payload)
        return _fake_out()

    s1 = await separate_stems(MUSIC, audio, separator=sep)
    s2 = await separate_stems(MUSIC, audio, separator=sep)
    assert s1.gain == 0.9 and s2 == s1
    assert len(calls) == 1  # cache hit → no second Modal call
    assert (stems_dir("aud:sep") / "meta.json").exists()


async def test_podcast_skips_with_default_mode(tmp_path):
    audio = tmp_path / "a.mp3"
    audio.write_bytes(b"x")
    assert await separate_stems(POD, audio, separator=lambda b: None) is None


async def test_prepare_uses_vocals_and_vocals_cache(monkeypatch, tmp_path):
    """prepare() transcribes the vocal stem into <key>.vocals.json."""
    from audio_angel import audio as audio_mod
    from audio_angel import transcribe as tr_mod

    audio = tmp_path / "aud_sep.mp3"
    audio.write_bytes(b"mix")

    async def fake_download(track, client=None):
        return audio

    seen: dict = {}

    async def sep(payload: bytes):
        return _fake_out()

    async def fake_transcribe(data, **kw):
        seen.update(kw)
        return Transcript(
            source_key=kw["source_key"],
            kind=kw["kind"],
            duration_ms=1000,
            segments=[],
            audio_source=kw.get("audio_source", "mix"),
        )

    monkeypatch.setattr(audio_mod, "download_audio", fake_download)
    monkeypatch.setattr(pipeline, "download_audio", fake_download)
    monkeypatch.setattr(tr_mod, "transcribe_audio", fake_transcribe)
    monkeypatch.setattr(pipeline, "transcribe_audio", fake_transcribe)
    monkeypatch.setenv("MODAL_TOKEN_ID", "id")
    monkeypatch.setenv("MODAL_TOKEN_SECRET", "sec")

    status: dict = {}
    t = await pipeline.prepare(
        MUSIC, use_separation=True, separation_status=status, separator=sep
    )
    assert seen["audio_source"] == "vocals"
    assert seen["content_type"] == "audio/flac"
    assert t.audio_source == "vocals"
    assert status["separation"] == "modal"
    assert status["separation_s"] == 1.2


async def test_prepare_falls_back_on_separation_error(monkeypatch, tmp_path):

    audio = tmp_path / "aud_sep2.mp3"
    audio.write_bytes(b"mix")

    async def fake_download(track, client=None):
        return audio

    async def sep(payload: bytes):
        raise RuntimeError("modal blew up")

    async def fake_transcribe(data, **kw):
        return Transcript(
            source_key=kw["source_key"],
            kind=kw["kind"],
            duration_ms=1000,
            segments=[],
            audio_source=kw.get("audio_source", "mix"),
        )

    monkeypatch.setattr(pipeline, "download_audio", fake_download)
    monkeypatch.setattr(pipeline, "transcribe_audio", fake_transcribe)
    monkeypatch.setenv("MODAL_TOKEN_ID", "id")
    monkeypatch.setenv("MODAL_TOKEN_SECRET", "sec")
    track = MUSIC.model_copy(update={"source_key": "aud:sep2"})

    status: dict = {}
    t = await pipeline.prepare(
        track, use_separation=True, separation_status=status, separator=sep
    )
    assert t.audio_source == "mix"  # full-mix fallback
    assert status["separation"].startswith("failed")


def test_vocals_pads(tmp_path):
    """Vocal-stem transcripts use −40/+70 ms word pads."""
    word = Word(text="bad", start_ms=1000, end_ms=1200, confidence=0.9)
    seg = Segment(index=0, start_ms=900, end_ms=1500, text="bad", words=[word])
    base = Transcript(source_key="k", kind="music", duration_ms=3000, segments=[seg])
    vocals = base.model_copy(update={"audio_source": "vocals"})
    flag = LineFlag(line_index=0, rule_id="profanity", words=["bad"], confidence=0.9)
    mix_iv = flags_to_intervals([flag], base).intervals[0]
    voc_iv = flags_to_intervals([flag], vocals).intervals[0]
    assert (mix_iv.start_ms, mix_iv.end_ms) == (850, 1350)  # ±150 music
    assert (voc_iv.start_ms, voc_iv.end_ms) == (960, 1270)  # −40/+70


def test_render_stems_filter(tmp_path, monkeypatch):
    """Stems render: vocals muted, amix with instrumental, gain applied."""
    captured = {}

    def fake_run(cmd, **kw):
        captured["cmd"] = cmd
        Path(cmd[-1]).write_bytes(b"mp3")

        class R:
            returncode = 0
            stderr = ""

        return R()

    monkeypatch.setattr("audio_angel.render.subprocess.run", fake_run)
    monkeypatch.setattr("audio_angel.render.ffmpeg_path", lambda: "ffmpeg")
    stems = Stems(
        tmp_path / "v.flac",
        tmp_path / "i.flac",
        gain=0.85,
        duration_s=1.0,
        separation_s=0.1,
    )
    for f in (stems.vocals_path, stems.instrumental_path):
        f.write_bytes(b"x")
    out = render_muted(
        tmp_path / "mix.mp3",
        "aud:sep",
        [MuteInterval(start_ms=100, end_ms=500)],
        stems=stems,
    )
    graph = captured["cmd"][captured["cmd"].index("-filter_complex") + 1]
    assert "volume=enable='between(t,0.100,0.500)':volume=0[v]" in graph
    assert "amix=inputs=2:normalize=0" in graph
    assert "volume=0.850000" in graph
    assert out.name.endswith(".mp3")


def test_render_empty_intervals_with_stems_still_mixes(tmp_path, monkeypatch):
    """Stems + no intervals must run the amix+gain graph (not a copy)
    so the 'Original' A/B shares the muted output's gain."""
    captured = {}

    def fake_run(cmd, **kw):
        captured["cmd"] = cmd
        Path(cmd[-1]).write_bytes(b"mp3")

        class R:
            returncode = 0
            stderr = ""

        return R()

    monkeypatch.setattr("audio_angel.render.subprocess.run", fake_run)
    monkeypatch.setattr("audio_angel.render.ffmpeg_path", lambda: "ffmpeg")
    stems = Stems(
        tmp_path / "v.flac",
        tmp_path / "i.flac",
        gain=0.73,
        duration_s=1.0,
        separation_s=0.1,
    )
    for f in (stems.vocals_path, stems.instrumental_path):
        f.write_bytes(b"x")
    mix = tmp_path / "mix.mp3"
    mix.write_bytes(b"source")
    out = render_muted(mix, "aud:sep", [], stems=stems)
    cmd = captured["cmd"]
    assert "-filter_complex" in cmd  # graph ran, not a copy
    graph = cmd[cmd.index("-filter_complex") + 1]
    assert "amix=inputs=2:normalize=0" in graph
    assert "volume=0.730000" in graph
    assert mix.read_bytes() == b"source"  # untouched
    assert out.exists()


def test_real_ffmpeg_stems_render(tmp_path):
    """Mute a sine 'vocal' stem over a different-frequency sine
    'instrumental': output exists with the right duration."""
    import shutil as sh
    import subprocess

    ffmpeg = sh.which("ffmpeg")
    if not ffmpeg or not sh.which("ffprobe"):
        pytest.skip("ffmpeg not installed")
    v = tmp_path / "v.flac"
    i = tmp_path / "i.flac"
    for path, freq in ((v, 440), (i, 220)):
        subprocess.run(
            [
                ffmpeg,
                "-y",
                "-f",
                "lavfi",
                "-i",
                f"sine=frequency={freq}:duration=1",
                str(path),
            ],
            check=True,
            capture_output=True,
        )
    stems = Stems(v, i, gain=0.9, duration_s=1.0, separation_s=0.0)
    out = render_muted(
        tmp_path / "src.mp3",
        "aud:sine",
        [MuteInterval(start_ms=200, end_ms=600)],
        stems=stems,
    )
    assert out.exists() and out.stat().st_size > 0
    probe = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            str(out),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    assert abs(float(probe.stdout.strip()) - 1.0) < 0.1
