/**
 * Podcast RSS/Atom feed parsing via fast-xml-parser. Feeds are fetched
 * through the SSRF-light safeFetch wrapper and capped at 5 MB.
 */

import { XMLParser } from "fast-xml-parser";
import { fetchText } from "./safeFetch";

const MAX_EPISODES = 100;
const FEED_MAX_BYTES = 5 * 1024 * 1024;

export type ParsedEpisode = {
  guid: string;
  title: string;
  publishedAt: number | null;
  durationMs: number | null;
  enclosureUrl: string | null;
  sourceKey: string;
};

export type ParsedFeed = {
  title: string;
  imageUrl?: string;
  episodes: ParsedEpisode[];
};

type XmlNode = Record<string, unknown>;

const asNodes = (value: unknown): XmlNode[] => {
  if (value === null || value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).filter(
    (item): item is XmlNode =>
      item !== null && typeof item === "object" && !Array.isArray(item),
  );
};

/**
 * Pulls text out of fast-xml-parser output: plain strings, `#text` when
 * attributes are present, or `__cdata` for CDATA sections.
 */
const textOf = (value: unknown): string | undefined => {
  if (Array.isArray(value)) {
    // removeNSPrefix can collapse e.g. <title> + <itunes:title> into one key.
    for (const entry of value) {
      const text = textOf(entry);
      if (text !== undefined) return text;
    }
    return undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value !== null && typeof value === "object") {
    const node = value as XmlNode;
    return textOf(node.__cdata) ?? textOf(node["#text"]);
  }
  return undefined;
};

const httpsOnly = (value: unknown): string | undefined => {
  const url = textOf(value);
  return url !== undefined && url.startsWith("https://") ? url : undefined;
};

const parseDate = (value: unknown): number | null => {
  const text = textOf(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Parses "HH:MM:SS", "MM:SS" or a plain seconds string into ms. */
export const parseDurationMs = (value: unknown): number | null => {
  const text = textOf(value);
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000);
  const parts = text.split(":");
  if (
    parts.length >= 2 &&
    parts.length <= 3 &&
    parts.every((part) => /^\d+(?:\.\d+)?$/.test(part.trim()))
  ) {
    const numbers = parts.map((part) => Number(part.trim()));
    const [hours, minutes, seconds] =
      numbers.length === 3 ? numbers : [0, numbers[0], numbers[1]];
    return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
  }
  return null;
};

/** Stable source key for a podcast episode: pod: + sha256(feedUrl|guid)[:32]. */
export async function podcastSourceKey(
  feedUrl: string,
  guid: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${feedUrl}|${guid}`),
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `pod:${hex.slice(0, 32)}`;
}

const channelImageUrl = (channel: XmlNode): string | undefined => {
  // removeNSPrefix collapses itunes:image and image onto the same key.
  const direct = httpsOnly(channel.image);
  if (direct) return direct;
  for (const image of asNodes(channel.image)) {
    const href = httpsOnly(image["@_href"]);
    if (href) return href;
    const url = httpsOnly(image.url);
    if (url) return url;
  }
  return undefined;
};

const rssEpisodes = (channel: XmlNode): Omit<ParsedEpisode, "sourceKey">[] => {
  const items = asNodes(channel.item).slice(0, MAX_EPISODES);
  const episodes: Omit<ParsedEpisode, "sourceKey">[] = [];
  for (const item of items) {
    const title = textOf(item.title) ?? "Untitled episode";
    const guid =
      textOf(item.guid) ?? textOf(item.link) ?? title;
    const enclosure =
      httpsOnly(asNodes(item.enclosure)[0]?.["@_url"]) ??
      httpsOnly(asNodes(item.content)[0]?.["@_url"]) ??
      null;
    episodes.push({
      guid,
      title,
      publishedAt: parseDate(item.pubDate),
      durationMs: parseDurationMs(item.duration),
      enclosureUrl: enclosure,
    });
  }
  return episodes;
};

const atomEpisodes = (feed: XmlNode): Omit<ParsedEpisode, "sourceKey">[] => {
  const entries = asNodes(feed.entry).slice(0, MAX_EPISODES);
  const episodes: Omit<ParsedEpisode, "sourceKey">[] = [];
  for (const entry of entries) {
    const title = textOf(entry.title) ?? "Untitled episode";
    const guid = textOf(entry.id) ?? title;
    const links = asNodes(entry.link);
    const enclosure =
      httpsOnly(
        links.find((link) => link["@_rel"] === "enclosure")?.["@_href"],
      ) ?? null;
    episodes.push({
      guid,
      title,
      publishedAt: parseDate(entry.published) ?? parseDate(entry.updated),
      durationMs: parseDurationMs(entry.duration),
      enclosureUrl: enclosure,
    });
  }
  return episodes;
};

/**
 * Parses RSS 2.0 (`rss.channel.item`) and, minimally, Atom (`feed.entry`).
 * Async because each episode's sourceKey is a SHA-256 digest.
 */
export async function parseFeed(
  xml: string,
  feedUrl: string,
): Promise<ParsedFeed> {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
    parseTagValue: false,
  });
  const doc = parser.parse(xml) as XmlNode;
  const rss = asNodes(doc.rss)[0];
  const channel = asNodes(rss?.channel)[0];
  const atom = asNodes(doc.feed)[0];
  let title = "Untitled podcast";
  let imageUrl: string | undefined;
  let rawEpisodes: Omit<ParsedEpisode, "sourceKey">[] = [];
  if (channel) {
    title = textOf(channel.title) ?? title;
    imageUrl = channelImageUrl(channel);
    rawEpisodes = rssEpisodes(channel);
  } else if (atom) {
    title = textOf(atom.title) ?? title;
    imageUrl = httpsOnly(atom.logo) ?? httpsOnly(atom.icon);
    rawEpisodes = atomEpisodes(atom);
  }
  const episodes = await Promise.all(
    rawEpisodes.map(async (episode) => ({
      ...episode,
      sourceKey: await podcastSourceKey(feedUrl, episode.guid),
    })),
  );
  return { title, imageUrl, episodes };
}

/** Fetches a feed through the SSRF guard and parses it. */
export async function listEpisodes(feedUrl: string): Promise<ParsedFeed> {
  const xml = await fetchText(feedUrl, { maxBytes: FEED_MAX_BYTES });
  return await parseFeed(xml, feedUrl);
}
