"""Audius public API client. Port of convex/lib/audius.ts.

No API key required; every request carries app_name=audio-angel.
"""

from __future__ import annotations

from urllib.parse import quote

import httpx

from audio_angel.models import Track

API = "https://api.audius.co/v1"
APP_NAME = "audio-angel"


class AudiusError(Exception):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


def _record(value: object) -> dict | None:
    return value if isinstance(value, dict) else None


def _string(value: object) -> str | None:
    return value if isinstance(value, str) and value != "" else None


def _map_track(raw: object) -> Track | None:
    track = _record(raw)
    if not track:
        return None
    track_id = _string(track.get("id"))
    title = _string(track.get("title"))
    if not track_id or not title:
        return None
    user = _record(track.get("user")) or {}
    artwork = _record(track.get("artwork")) or {}
    duration = track.get("duration")
    duration_ms = round(duration * 1000) if isinstance(duration, (int, float)) else None
    is_streamable = (
        track.get("is_streamable") is True
        and track.get("is_stream_gated") is not True
        and track.get("is_available") is not False
    )
    if not is_streamable:
        return None
    return Track(
        source_key=f"aud:{track_id}",
        kind="music",
        title=title,
        artist=_string(user.get("name")) or "Unknown artist",
        duration_ms=duration_ms,
        genre=_string(track.get("genre")),
        artwork_url=_string(artwork.get("480x480")),
        source_ids={"audius_track_id": track_id},
    )


async def _get_json(client: httpx.AsyncClient, url: str) -> object:
    res = await client.get(url, timeout=15.0)
    if res.status_code >= 400:
        raise AudiusError(
            f"Audius HTTP {res.status_code}: {res.text[:200]}", res.status_code
        )
    return res.json()


async def search_tracks(
    query: str, *, client: httpx.AsyncClient, genre: str | None = None
) -> list[Track]:
    """Search Audius tracks; an empty query returns the trending list.

    `genre` (e.g. "Hip-Hop/Rap") narrows results — vocal-heavy lanes
    transcribe better than instrumental electronic tracks.
    """
    q = query.strip()
    genre_param = f"&genre={quote(genre)}" if genre else ""
    url = (
        f"{API}/tracks/search?query={quote(q)}&limit=10&app_name={APP_NAME}{genre_param}"
        if q
        else f"{API}/tracks/trending?limit=10&app_name={APP_NAME}{genre_param}"
    )
    body = _record(await _get_json(client, url)) or {}
    data = body.get("data")
    items = data if isinstance(data, list) else []
    return [track for track in (_map_track(item) for item in items) if track]


async def get_track(track_id: str, *, client: httpx.AsyncClient) -> Track:
    """Fetch a single Audius track by id."""
    url = f"{API}/tracks/{quote(track_id)}?app_name={APP_NAME}"
    body = _record(await _get_json(client, url)) or {}
    track = _map_track(body.get("data"))
    if not track:
        raise AudiusError(f"Audius track {track_id} was not found")
    return track


async def stream_url(track_id: str, *, client: httpx.AsyncClient) -> str:
    """Resolve the signed stream URL (no_redirect=true returns JSON)."""
    url = f"{API}/tracks/{quote(track_id)}/stream?app_name={APP_NAME}&no_redirect=true"
    body = _record(await _get_json(client, url)) or {}
    data = _string(body.get("data"))
    if not data:
        raise AudiusError(f"Audius gave no stream URL for {track_id}")
    return data
