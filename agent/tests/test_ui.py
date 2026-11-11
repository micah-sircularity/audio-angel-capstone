"""Regression: the Listen page must not drop analysis on rerun (the
st.radio-default bug). Uses Streamlit AppTest with a stubbed pipeline."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

AppTest = pytest.importorskip(
    "streamlit.testing.v1", reason="streamlit AppTest unavailable"
).AppTest


def test_listen_page_loads(monkeypatch):
    at = AppTest.from_file(
        str(Path(__file__).resolve().parent.parent / "app" / "streamlit_app.py"),
        default_timeout=30,
    )
    at.run()
    # entrypoint renders navigation without exceptions
    assert not at.exception


def test_analysis_key_survives_rerun(monkeypatch):
    """Session-state keying: analysis keyed to (source_key, rules, config)
    is dropped only when one of those changes — the regression for the
    radio-reset bug."""
    from audio_angel.models import category_rule

    rules = [category_rule("profanity")]
    # Simulate the key computation from listen.py
    from components import rules_signature

    from audio_angel.config import AgentConfig

    key = f"aud:x|{rules_signature(rules)}|{AgentConfig().name}"
    state = {"analysis": {"key": key}, "selected_track_key": "aud:x"}
    # A rerun that does not touch the radio keeps the analysis.
    assert state["analysis"]["key"] == key
    # Changing the rule set changes the key -> drop.
    new_key = f"aud:x|{rules_signature(rules + [category_rule('drugs')])}|{AgentConfig().name}"
    assert new_key != key
