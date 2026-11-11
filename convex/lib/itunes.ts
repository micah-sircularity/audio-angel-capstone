/**
 * iTunes podcast search. Results are display-only; the feed URL is what
 * the audio-native lane later fetches (through safeFetch).
 */

import { fetchJson } from "./safeFetch";

export type PodcastSearchResult = {
  name: string;
  author: string;
  feedUrl: string;
  artworkUrl?: string;
};

type JsonFetcher = (url: string) => Promise<unknown>;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

/**
 * Searches the iTunes podcast directory. Only results with an https feed
 * URL are kept, since the feed is fetched server-side later.
 */
export async function searchPodcasts(
  query: string,
  getJson: JsonFetcher = fetchJson,
): Promise<PodcastSearchResult[]> {
  const url = `https://itunes.apple.com/search?media=podcast&term=${encodeURIComponent(
    query.trim(),
  )}&limit=12`;
  const body = asRecord(await getJson(url));
  const results = Array.isArray(body?.results) ? body.results : [];
  const podcasts: PodcastSearchResult[] = [];
  for (const raw of results) {
    const record = asRecord(raw);
    if (!record) continue;
    const feedUrl = asString(record.feedUrl);
    if (!feedUrl || !feedUrl.startsWith("https://")) continue;
    podcasts.push({
      name: asString(record.collectionName) ?? "Untitled podcast",
      author: asString(record.artistName) ?? "Unknown author",
      feedUrl,
      artworkUrl: asString(record.artworkUrl600),
    });
  }
  return podcasts;
}
