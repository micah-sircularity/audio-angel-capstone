import httpx
import pytest

from audio_angel.sources.audius import (
    AudiusError,
    get_track,
    search_tracks,
    stream_url,
)


def client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


RAW_TRACK = {
    "id": "abc123",
    "title": "Song One",
    "duration": 3.5,
    "user": {"name": "Artist A"},
    "artwork": {"480x480": "https://img/480.png"},
    "track_cid": "cid1",
    "is_streamable": True,
    "is_stream_gated": False,
    "is_available": True,
}


def search_handler(request: httpx.Request) -> httpx.Response:
    if "tracks/search" in str(request.url):
        assert "query=cats" in str(request.url)
    if "trending" in str(request.url):
        assert "query" not in str(request.url)
    return httpx.Response(
        200,
        json={
            "data": [
                RAW_TRACK,
                {**RAW_TRACK, "id": "gated", "is_stream_gated": True},
                {**RAW_TRACK, "id": "gone", "is_available": False},
                {"id": "bad"},  # no title -> dropped
            ]
        },
    )


async def test_search_maps_and_filters_streamable():
    async with client(search_handler) as c:
        tracks = await search_tracks("cats", client=c)
    assert [t.source_key for t in tracks] == ["aud:abc123"]
    t = tracks[0]
    assert t.kind == "music"
    assert t.title == "Song One"
    assert t.artist == "Artist A"
    assert t.duration_ms == 3500
    assert t.artwork_url == "https://img/480.png"
    assert t.source_ids["audius_track_id"] == "abc123"


async def test_trending_on_empty_query():
    async with client(search_handler) as c:
        tracks = await search_tracks("   ", client=c)
    assert len(tracks) == 1


async def test_get_track_and_stream_url():
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if (
            url.endswith("/stream?app_name=audio-angel&no_redirect=true")
            or "/stream" in url
        ):
            return httpx.Response(200, json={"data": "https://cdn.audius/stream.mp3"})
        return httpx.Response(200, json={"data": RAW_TRACK})

    async with client(handler) as c:
        track = await get_track("abc123", client=c)
        assert track.source_key == "aud:abc123"
        url = await stream_url("abc123", client=c)
        assert url == "https://cdn.audius/stream.mp3"


async def test_http_error_raises():
    def handler(request):
        return httpx.Response(500, text="boom")

    async with client(handler) as c:
        with pytest.raises(AudiusError, match="HTTP 500"):
            await search_tracks("x", client=c)


async def test_missing_track_raises():
    def handler(request):
        return httpx.Response(200, json={"data": None})

    async with client(handler) as c:
        with pytest.raises(AudiusError, match="not found"):
            await get_track("nope", client=c)


async def test_genre_param_on_trending_and_search():
    seen: list[httpx.URL] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url)
        return httpx.Response(200, json={"data": [RAW_TRACK]})

    async with client(handler) as c:
        await search_tracks("", client=c, genre="Hip-Hop/Rap")
        await search_tracks("drake", client=c, genre="Hip-Hop/Rap")
        await search_tracks("", client=c)
    assert seen[0].params.get("genre") == "Hip-Hop/Rap"
    assert seen[0].path.endswith("/tracks/trending")
    assert seen[1].params.get("genre") == "Hip-Hop/Rap"
    assert seen[1].path.endswith("/tracks/search")
    assert "genre" not in seen[2].params


def test_track_label_includes_genre():
    import sys

    sys.path.insert(0, "app")
    from components import track_label

    from audio_angel.models import Track

    t = Track(
        source_key="aud:x",
        kind="music",
        title="Song",
        artist="A",
        duration_ms=61000,
        genre="Hip-Hop/Rap",
    )
    assert track_label(t) == "Song — A · Hip-Hop/Rap (1:01)"
    t2 = t.model_copy(update={"genre": None})
    assert track_label(t2) == "Song — A (1:01)"
