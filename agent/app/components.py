"""Shared Streamlit components for the Audio Angel pages.

The source picker stores the selected Track in
st.session_state["selected_track"] and only changes it inside
on_change callbacks, so a rerun never silently resets the selection.
"""

from __future__ import annotations

import asyncio

import httpx
import streamlit as st

from audio_angel.models import MuteRule, Track
from audio_angel.sources import audius, podcasts
from audio_angel.sources.safe import SafeFetchError


def run(coro):
    return asyncio.run(coro)


def fmt_ms(ms: int | None) -> str:
    if ms is None:
        return "?:??"
    total = int(ms // 1000)
    return f"{total // 60}:{total % 60:02d}"


def track_label(track: Track) -> str:
    genre = f" · {track.genre}" if track.genre else ""
    return f"{track.title} — {track.artist}{genre} ({fmt_ms(track.duration_ms)})"


AUDIUS_GENRES = (
    "Hip-Hop/Rap",
    "R&B/Soul",
    "Pop",
    "Rock",
    "Alternative",
    "Country",
    "All genres",
)


def rules_signature(rules: list[MuteRule]) -> str:
    return "|".join(sorted(rule.id for rule in rules))


def _select_track(track: Track) -> None:
    if (
        st.session_state.get("selected_track") is None
        or st.session_state["selected_track"].source_key != track.source_key
    ):
        st.session_state.pop("analysis", None)
    st.session_state["selected_track"] = track


def _on_audius_pick() -> None:
    tracks = st.session_state.get("audius_results", [])
    idx = st.session_state.get("audius_pick")
    if idx is not None and 0 <= idx < len(tracks):
        _select_track(tracks[idx])


def _on_episode_pick() -> None:
    episodes = st.session_state.get("pod_episodes", [])
    idx = st.session_state.get("pod_ep_pick")
    if idx is not None and 0 <= idx < len(episodes):
        _select_track(episodes[idx])


def source_picker() -> Track | None:
    """Audius / Podcast source tabs; returns the selected Track."""
    tab_audius, tab_podcast = st.tabs(["Audius", "Podcast"])

    with tab_audius:
        c_query, c_genre = st.columns([3, 1])
        c_query.text_input("Search Audius (empty = trending)", key="audius_q")
        genre = c_genre.selectbox(
            "Genre",
            AUDIUS_GENRES,
            key="audius_genre",
            on_change=lambda: st.session_state.pop("audius_results", None),
        )
        col_search, _ = st.columns([1, 3])
        with col_search:
            clicked = st.button("Search Audius", key="audius_go")
        if clicked or "audius_results" not in st.session_state:
            genre_param = None if genre == "All genres" else genre

            async def _audius():
                async with httpx.AsyncClient() as client:
                    return await audius.search_tracks(
                        st.session_state.get("audius_q", ""),
                        client=client,
                        genre=genre_param,
                    )

            try:
                st.session_state.audius_results = run(_audius())
            except Exception as exc:  # noqa: BLE001
                st.error(f"Audius search failed: {exc}")
                st.session_state.audius_results = []
        tracks = st.session_state.get("audius_results", [])
        if tracks:
            st.radio(
                "Tracks",
                range(len(tracks)),
                format_func=lambda i: track_label(tracks[i]),
                key="audius_pick",
                on_change=_on_audius_pick,
            )

    with tab_podcast:
        st.text_input("Search podcasts", key="pod_q")
        if (
            st.button("Search podcasts", key="pod_go")
            and st.session_state.get("pod_q", "").strip()
        ):

            async def _shows():
                async with httpx.AsyncClient() as client:
                    return await podcasts.search_shows(
                        st.session_state["pod_q"], client=client
                    )

            try:
                st.session_state.pod_shows = run(_shows())
            except Exception as exc:  # noqa: BLE001
                st.error(f"Podcast search failed: {exc}")
                st.session_state.pod_shows = []
        shows = st.session_state.get("pod_shows", [])
        if shows:
            show_idx = st.radio(
                "Shows",
                range(len(shows)),
                format_func=lambda i: f"{shows[i].name} — {shows[i].author}",
                key="pod_show_pick",
            )
            show = shows[show_idx]
            if st.button("List episodes", key="pod_eps_go"):

                async def _eps():
                    async with httpx.AsyncClient() as client:
                        return await podcasts.list_episodes(
                            show.feed_url, client=client
                        )

                try:
                    _, _, eps = run(_eps())
                    st.session_state.pod_episodes = eps
                except SafeFetchError as exc:
                    st.error(f"Feed rejected: {exc}")
                    st.session_state.pod_episodes = []
                except Exception as exc:  # noqa: BLE001
                    st.error(f"Could not load feed: {exc}")
                    st.session_state.pod_episodes = []
            episodes = st.session_state.get("pod_episodes", [])
            if episodes:
                st.radio(
                    "Episodes",
                    range(len(episodes)),
                    format_func=lambda i: track_label(episodes[i]),
                    key="pod_ep_pick",
                    on_change=_on_episode_pick,
                )

    track = st.session_state.get("selected_track")
    if track:
        st.success(f"Selected: {track_label(track)}")
    return track


def env_warnings() -> None:
    """Banner listing missing keys/tools the pipeline needs."""
    import os
    import shutil

    missing = []
    if not os.environ.get("FIREWORKS_API_KEY", "").strip():
        missing.append("`FIREWORKS_API_KEY` (the flagging agent)")
    if not os.environ.get("DEEPGRAM_API_KEY", "").strip():
        missing.append("`DEEPGRAM_API_KEY` (transcription)")
    if not shutil.which("ffmpeg"):
        missing.append("`ffmpeg` on PATH (audio download/render)")
    if missing:
        st.warning(
            "Missing: " + ", ".join(missing) + ". Add them to `.env` "
            "before running the pipeline."
        )
