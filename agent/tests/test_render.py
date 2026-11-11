import shutil

import pytest

from audio_angel.models import MuteInterval
from audio_angel.render import _volume_filter, render_muted


def test_volume_filter_string():
    ivs = [
        MuteInterval(start_ms=1000, end_ms=2500, rule_ids=["profanity"]),
        MuteInterval(start_ms=7000, end_ms=8000, rule_ids=["drugs"]),
    ]
    assert _volume_filter(ivs) == (
        "volume=enable='between(t,1.000,2.500)+between(t,7.000,8.000)':volume=0"
    )


def test_render_copies_when_no_intervals(tmp_path):
    src = tmp_path / "in.mp3"
    src.write_bytes(b"fake-mp3")
    out = render_muted(src, "aud:x", [])
    assert out.read_bytes() == b"fake-mp3"
    assert out.name.startswith("aud_x-")


def test_render_missing_ffmpeg_clear_error(tmp_path, monkeypatch):
    if shutil.which("ffmpeg"):
        pytest.skip("ffmpeg is installed")
    src = tmp_path / "in.mp3"
    src.write_bytes(b"x")
    with pytest.raises(Exception, match="ffmpeg"):
        render_muted(src, "aud:x", [MuteInterval(start_ms=0, end_ms=1)])


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg not installed")
def test_real_ffmpeg_mute_run(tmp_path):
    import subprocess

    src = tmp_path / "sine.mp3"
    gen = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=2",
            str(src),
        ],
        check=False,
        capture_output=True,
    )
    assert gen.returncode == 0
    out = render_muted(
        src,
        "aud:sine",
        [MuteInterval(start_ms=500, end_ms=1500, rule_ids=["profanity"])],
    )
    assert out.exists() and out.stat().st_size > 0

    # Verify the muted section is actually silent via astats.
    probe = subprocess.run(
        [
            "ffmpeg",
            "-i",
            str(out),
            "-af",
            "astats=metadata=1:reset=0,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
            "-f",
            "null",
            "-",
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    assert probe.returncode == 0
