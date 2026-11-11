import httpx

from audio_angel.sources.podcasts import (
    parse_duration_ms,
    parse_feed,
    podcast_source_key,
    search_shows,
)

RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Test Show</title>
    <itunes:image href="https://img/show.jpg"/>
    <item>
      <title>Ep 42</title>
      <guid>ep-42</guid>
      <pubDate>Mon, 01 Jan 2024 00:00:00 +0000</pubDate>
      <itunes:duration>12:30</itunes:duration>
      <enclosure url="https://cdn.example.com/ep42.mp3" type="audio/mpeg"/>
    </item>
    <item>
      <title>Ep 43</title>
      <guid>ep-43</guid>
      <itunes:duration>3720</itunes:duration>
      <enclosure url="http://insecure.example.com/ep43.mp3"/>
      <media:content url="https://cdn.example.com/ep43.mp3"/>
    </item>
    <item>
      <title>Ep 44</title>
      <guid>ep-44</guid>
      <itunes:duration>1:02:03</itunes:duration>
    </item>
  </channel>
</rss>
"""


def test_source_key_matches_ts_algorithm():
    # sha256("https://example.com/feed.xml|ep-42")[:32] — computed from the
    # TS implementation; do not change without changing rss.ts.
    assert (
        podcast_source_key("https://example.com/feed.xml", "ep-42")
        == "pod:0b8a42a4d8294809184222ef6346ddb5"
    )


def test_parse_duration_ms():
    assert parse_duration_ms("90") == 90_000
    assert parse_duration_ms("12:30") == 750_000
    assert parse_duration_ms("1:02:03") == 3_723_000
    assert parse_duration_ms("abc") is None
    assert parse_duration_ms(None) is None


def test_parse_feed_rss():
    title, image, episodes = parse_feed(RSS, "https://example.com/feed.xml")
    assert title == "Test Show"
    assert image == "https://img/show.jpg"
    assert len(episodes) == 3
    ep = episodes[0]
    assert ep.kind == "podcast"
    assert ep.title == "Ep 42"
    assert ep.duration_ms == 750_000
    assert ep.audio_url == "https://cdn.example.com/ep42.mp3"
    assert ep.source_key == podcast_source_key("https://example.com/feed.xml", "ep-42")
    # http enclosure rejected, https media:content used instead.
    assert episodes[1].audio_url == "https://cdn.example.com/ep43.mp3"
    assert episodes[2].audio_url is None


def test_parse_feed_atom():
    atom = """<?xml version="1.0"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <title>Atom Show</title>
      <entry>
        <title>A1</title>
        <id>urn:a1</id>
        <link rel="enclosure" href="https://cdn.example.com/a1.mp3"/>
        <published>2024-01-01T00:00:00Z</published>
      </entry>
    </feed>"""
    title, _, episodes = parse_feed(atom, "https://example.com/atom.xml")
    assert title == "Atom Show"
    assert len(episodes) == 1
    assert episodes[0].audio_url == "https://cdn.example.com/a1.mp3"


async def test_search_shows_filters_non_https_feeds():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "results": [
                    {
                        "collectionName": "Show A",
                        "artistName": "Author A",
                        "feedUrl": "https://feeds.example.com/a.xml",
                        "artworkUrl600": "https://img/a.jpg",
                    },
                    {
                        "collectionName": "Insecure",
                        "feedUrl": "http://feeds.example.com/b.xml",
                    },
                ]
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        shows = await search_shows("test", client=client)
    assert len(shows) == 1
    assert shows[0].name == "Show A"
    assert shows[0].feed_url.startswith("https://")


def test_fetch_bytes_truncate_returns_prefix_of_oversized_body():
    import asyncio

    import httpx

    from audio_angel.sources.safe import SafeFetchError, fetch_bytes

    body = b"x" * 5000

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=body, headers={"content-length": "5000"})

    async def run(truncate: bool) -> bytes:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await fetch_bytes(
                "https://cdn.example.com/ep.mp3",
                client=client,
                max_bytes=1200,
                truncate=truncate,
            )

    assert asyncio.run(run(True)) == body[:1200]
    try:
        asyncio.run(run(False))
    except SafeFetchError as exc:
        assert exc.code == "too-large"
    else:
        raise AssertionError("expected too-large without truncate")
