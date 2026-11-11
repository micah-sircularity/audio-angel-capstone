import { describe, expect, it } from "vitest";
import {
  parseDurationMs,
  parseFeed,
  podcastSourceKey,
} from "./rss";

const FEED_URL = "https://feeds.example.com/show.xml";

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title><![CDATA[Demo Show]]></title>
    <itunes:image href="https://cdn.example.com/cover.jpg"/>
    <item>
      <title><![CDATA[Episode One]]></title>
      <guid isPermaLink="false">ep-001</guid>
      <pubDate>Mon, 06 Jan 2025 12:00:00 GMT</pubDate>
      <itunes:duration>1:02:03</itunes:duration>
      <enclosure url="https://cdn.example.com/ep1.mp3" length="123" type="audio/mpeg"/>
    </item>
    <item>
      <title>Episode Two</title>
      <link>https://example.com/ep2</link>
      <pubDate>Tue, 07 Jan 2025 12:00:00 GMT</pubDate>
      <itunes:duration>95</itunes:duration>
      <enclosure url="http://insecure.example.com/ep2.mp3" type="audio/mpeg"/>
    </item>
    <item>
      <title>Episode Three</title>
      <guid>ep-003</guid>
      <itunes:duration>12:30</itunes:duration>
      <enclosure url="https://cdn.example.com/ep3.mp3" type="audio/mpeg"/>
    </item>
  </channel>
</rss>`;

describe("parseFeed (RSS)", () => {
  it("parses channel metadata and episodes", async () => {
    const feed = await parseFeed(RSS, FEED_URL);
    expect(feed.title).toBe("Demo Show");
    expect(feed.imageUrl).toBe("https://cdn.example.com/cover.jpg");
    expect(feed.episodes).toHaveLength(3);

    const [one, two, three] = feed.episodes;
    expect(one.guid).toBe("ep-001");
    expect(one.title).toBe("Episode One");
    expect(one.publishedAt).toBe(Date.parse("2025-01-06T12:00:00Z"));
    expect(one.durationMs).toBe(3_723_000);
    expect(one.enclosureUrl).toBe("https://cdn.example.com/ep1.mp3");
    expect(one.sourceKey).toMatch(/^pod:[0-9a-f]{32}$/);

    // No guid: falls back to the item link.
    expect(two.guid).toBe("https://example.com/ep2");
    expect(two.durationMs).toBe(95_000);
    // Non-https enclosures are dropped.
    expect(two.enclosureUrl).toBeNull();

    expect(three.durationMs).toBe(750_000);
  });
});

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Show</title>
  <entry>
    <id>atom-1</id>
    <title>Atom Episode</title>
    <published>2025-02-01T00:00:00Z</published>
    <link rel="enclosure" href="https://cdn.example.com/atom.mp3"/>
  </entry>
</feed>`;

describe("parseFeed (Atom)", () => {
  it("handles feed.entry minimally", async () => {
    const feed = await parseFeed(ATOM, FEED_URL);
    expect(feed.title).toBe("Atom Show");
    expect(feed.episodes).toHaveLength(1);
    expect(feed.episodes[0].guid).toBe("atom-1");
    expect(feed.episodes[0].enclosureUrl).toBe(
      "https://cdn.example.com/atom.mp3",
    );
    expect(feed.episodes[0].publishedAt).toBe(
      Date.parse("2025-02-01T00:00:00Z"),
    );
  });
});

describe("parseDurationMs", () => {
  it("parses HH:MM:SS, MM:SS and bare seconds", () => {
    expect(parseDurationMs("1:02:03")).toBe(3_723_000);
    expect(parseDurationMs("12:30")).toBe(750_000);
    expect(parseDurationMs("95")).toBe(95_000);
    expect(parseDurationMs("90.5")).toBe(90_500);
    expect(parseDurationMs("garbage")).toBeNull();
    expect(parseDurationMs(undefined)).toBeNull();
  });
});

describe("podcastSourceKey", () => {
  it("is a stable pod:-prefixed sha256 digest", async () => {
    const a = await podcastSourceKey(FEED_URL, "ep-001");
    const b = await podcastSourceKey(FEED_URL, "ep-001");
    const c = await podcastSourceKey(FEED_URL, "ep-002");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^pod:[0-9a-f]{32}$/);
  });
});
