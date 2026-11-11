"""Podcast directory search + RSS/Atom episode listing.

Ports convex/lib/itunes.ts (iTunes show search) and convex/lib/rss.ts
(feed parsing) using stdlib xml.etree.ElementTree. Feeds are fetched
through the safe.py SSRF guard and capped at 5 MB.
"""

from __future__ import annotations

import hashlib
import re
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from urllib.parse import quote
from xml.etree import ElementTree

import httpx
from pydantic import BaseModel

from audio_angel.models import Track
from audio_angel.sources.safe import fetch_text

MAX_EPISODES = 100
FEED_MAX_BYTES = 5 * 1024 * 1024


class PodcastError(Exception):
    pass


class PodcastShow(BaseModel):
    name: str
    author: str
    feed_url: str
    artwork_url: str | None = None


def _record(value: object) -> dict | None:
    return value if isinstance(value, dict) else None


def _string(value: object) -> str | None:
    return value if isinstance(value, str) and value != "" else None


async def search_shows(query: str, *, client: httpx.AsyncClient) -> list[PodcastShow]:
    """Search the iTunes podcast directory; https feeds only."""
    url = (
        "https://itunes.apple.com/search?media=podcast"
        f"&term={quote(query.strip())}&limit=12"
    )
    res = await client.get(url, timeout=15.0)
    if res.status_code >= 400:
        raise PodcastError(f"iTunes HTTP {res.status_code}: {res.text[:200]}")
    body = _record(res.json()) or {}
    results = body.get("results")
    items = results if isinstance(results, list) else []
    shows: list[PodcastShow] = []
    for raw in items:
        record = _record(raw)
        if not record:
            continue
        feed_url = _string(record.get("feedUrl"))
        if not feed_url or not feed_url.startswith("https://"):
            continue
        shows.append(
            PodcastShow(
                name=_string(record.get("collectionName")) or "Untitled podcast",
                author=_string(record.get("artistName")) or "Unknown author",
                feed_url=feed_url,
                artwork_url=_string(record.get("artworkUrl600")),
            )
        )
    return shows


def podcast_source_key(feed_url: str, guid: str) -> str:
    """Stable source key: pod: + sha256(feedUrl|guid)[:32]."""
    digest = hashlib.sha256(f"{feed_url}|{guid}".encode()).hexdigest()
    return f"pod:{digest[:32]}"


def _local(tag: str) -> str:
    """Local name of an ElementTree tag (strip {namespace})."""
    return tag.rsplit("}", 1)[-1]


def _children(node: ElementTree.Element, name: str) -> list[ElementTree.Element]:
    return [child for child in node if _local(child.tag) == name]


def _child(node: ElementTree.Element, name: str) -> ElementTree.Element | None:
    matches = _children(node, name)
    return matches[0] if matches else None


def _text(node: ElementTree.Element | None) -> str | None:
    if node is None:
        return None
    text = "".join(node.itertext()).strip()
    return text or None


def _text_of(node: ElementTree.Element, name: str) -> str | None:
    return _text(_child(node, name))


def _https(value: str | None) -> str | None:
    return value if value is not None and value.startswith("https://") else None


def _parse_date(value: str | None) -> int | None:
    """Parse RFC-2822 or ISO-8601 dates into epoch ms."""
    if not value:
        return None
    try:
        return int(parsedate_to_datetime(value).timestamp() * 1000)
    except (TypeError, ValueError):
        pass
    try:
        dt = datetime.fromisoformat(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return int(dt.timestamp() * 1000)
    except ValueError:
        return None


def parse_duration_ms(value: str | None) -> int | None:
    """Parse "HH:MM:SS", "MM:SS" or plain seconds into ms."""
    if not value:
        return None
    text = value.strip()
    if re.fullmatch(r"\d+(?:\.\d+)?", text):
        return round(float(text) * 1000)
    parts = text.split(":")
    if 2 <= len(parts) <= 3 and all(
        re.fullmatch(r"\d+(?:\.\d+)?", part.strip()) for part in parts
    ):
        numbers = [float(part.strip()) for part in parts]
        hours, minutes, seconds = (
            numbers if len(numbers) == 3 else (0.0, numbers[0], numbers[1])
        )
        return round((hours * 3600 + minutes * 60 + seconds) * 1000)
    return None


def _channel_image_url(channel: ElementTree.Element) -> str | None:
    for image in _children(channel, "image"):
        href = _https(image.get("href"))
        if href:
            return href
        url = _https(_text_of(image, "url"))
        if url:
            return url
        inline = _https(_text(image))
        if inline:
            return inline
    return None


def _rss_episodes(
    channel: ElementTree.Element, feed_url: str, show_title: str
) -> list[Track]:
    episodes: list[Track] = []
    for item in _children(channel, "item")[:MAX_EPISODES]:
        title = _text_of(item, "title") or "Untitled episode"
        guid = _text_of(item, "guid") or _text_of(item, "link") or title
        enclosure_url = None
        for tag in ("enclosure", "content"):
            for node in _children(item, tag):
                candidate = _https(node.get("url"))
                if candidate:
                    enclosure_url = candidate
                    break
            if enclosure_url:
                break
        episodes.append(
            Track(
                source_key=podcast_source_key(feed_url, guid),
                kind="podcast",
                title=title,
                artist=show_title,
                duration_ms=parse_duration_ms(_text_of(item, "duration")),
                audio_url=enclosure_url,
                source_ids={"feed_url": feed_url, "guid": guid},
            )
        )
    return episodes


def _atom_episodes(
    feed: ElementTree.Element, feed_url: str, show_title: str
) -> list[Track]:
    episodes: list[Track] = []
    for entry in _children(feed, "entry")[:MAX_EPISODES]:
        title = _text_of(entry, "title") or "Untitled episode"
        guid = _text_of(entry, "id") or title
        enclosure_url = None
        for link in _children(entry, "link"):
            if link.get("rel") == "enclosure":
                enclosure_url = _https(link.get("href"))
                if enclosure_url:
                    break
        episodes.append(
            Track(
                source_key=podcast_source_key(feed_url, guid),
                kind="podcast",
                title=title,
                artist=show_title,
                duration_ms=parse_duration_ms(_text_of(entry, "duration")),
                audio_url=enclosure_url,
                source_ids={"feed_url": feed_url, "guid": guid},
            )
        )
    return episodes


def parse_feed(xml: str, feed_url: str) -> tuple[str, str | None, list[Track]]:
    """Parse an RSS 2.0 or Atom feed into (title, image_url, episodes)."""
    try:
        root = ElementTree.fromstring(xml)
    except ElementTree.ParseError as exc:
        raise PodcastError(f"Feed at {feed_url[:120]} is not valid XML") from exc
    title = "Untitled podcast"
    image_url: str | None = None
    episodes: list[Track] = []
    if _local(root.tag) == "rss":
        channel = _child(root, "channel")
        if channel is not None:
            title = _text_of(channel, "title") or title
            image_url = _channel_image_url(channel)
            episodes = _rss_episodes(channel, feed_url, title)
    elif _local(root.tag) == "feed":
        title = _text_of(root, "title") or title
        image_url = _https(_text_of(root, "logo")) or _https(_text_of(root, "icon"))
        episodes = _atom_episodes(root, feed_url, title)
    return title, image_url, episodes


async def list_episodes(
    feed_url: str, *, client: httpx.AsyncClient
) -> tuple[str, str | None, list[Track]]:
    """Fetch a feed through the SSRF guard and parse it."""
    xml = await fetch_text(feed_url, client=client, max_bytes=FEED_MAX_BYTES)
    return parse_feed(xml, feed_url)
