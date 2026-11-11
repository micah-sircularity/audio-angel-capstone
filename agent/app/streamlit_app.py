"""Audio Angel flagging agent — Streamlit entrypoint.

Run: uv run streamlit run app/streamlit_app.py
Pages: Listen (pick + flag + render), Label (ground truth), Monitor
(run logs). st.navigation keeps the door open for more pages.
"""

from __future__ import annotations

from pathlib import Path

import streamlit as st
from dotenv import load_dotenv

# .env lives next to pyproject.toml in agent/; loaded only here so the
# library modules stay env-agnostic for tests.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from audio_angel.telemetry import setup_logfire

setup_logfire()

pages = [
    st.Page("pages/listen.py", title="Listen", icon="🎧", default=True),
    st.Page("pages/label.py", title="Label", icon="🏷️"),
    st.Page("pages/monitor.py", title="Monitor", icon="📈"),
]
st.navigation(pages).run()
