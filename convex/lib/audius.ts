/**
 * Audius public API client. No API key required; every request carries
 * app_name=audio-angel. `fetch` is injected for testability.
 */

import type { FetchLike } from "./safeFetch";

const API = "https://api.audius.co/v1";
const APP_NAME = "audio-angel";

export type AudiusTrack = {
  trackId: string;
  title: string;
  artist: string;
  durationMs: number;
  artworkUrl?: string;
  /** IPFS/content identifier for the audio, when present. */
  contentId?: string;
  isStreamable: boolean;
};

export class AudiusError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "AudiusError";
    this.status = status;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function mapTrack(raw: unknown): AudiusTrack | null {
  const track = asRecord(raw);
  if (!track) return null;
  const trackId = asString(track.id);
  const title = asString(track.title);
  if (!trackId || !title) return null;
  const user = asRecord(track.user);
  const artwork = asRecord(track.artwork);
  const durationSeconds =
    typeof track.duration === "number" ? track.duration : 0;
  return {
    trackId,
    title,
    artist: asString(user?.name) ?? "Unknown artist",
    durationMs: Math.round(durationSeconds * 1000),
    artworkUrl: asString(artwork?.["480x480"]),
    contentId: asString(track.track_cid),
    isStreamable:
      track.is_streamable === true &&
      track.is_stream_gated !== true &&
      track.is_available !== false,
  };
}

async function getJson(fetchImpl: FetchLike, url: string): Promise<unknown> {
  const res = await fetchImpl(url);
  if (!res.ok) {
    const excerpt = (await res.text().catch(() => "")).slice(0, 200);
    throw new AudiusError(
      `Audius HTTP ${res.status}: ${excerpt}`,
      res.status,
    );
  }
  return await res.json();
}

/**
 * Search Audius tracks; an empty query returns the trending list instead.
 */
export async function searchTracks(
  fetchImpl: FetchLike,
  query: string,
): Promise<AudiusTrack[]> {
  const q = query.trim();
  const url = q
    ? `${API}/tracks/search?query=${encodeURIComponent(q)}&limit=10&app_name=${APP_NAME}`
    : `${API}/tracks/trending?limit=10&app_name=${APP_NAME}`;
  const body = asRecord(await getJson(fetchImpl, url));
  const data = Array.isArray(body?.data) ? body.data : [];
  return data
    .map(mapTrack)
    .filter((track): track is AudiusTrack => track !== null);
}

/** Fetch a single Audius track by id. Throws AudiusError when missing. */
export async function getTrack(
  fetchImpl: FetchLike,
  trackId: string,
): Promise<AudiusTrack> {
  const url = `${API}/tracks/${encodeURIComponent(trackId)}?app_name=${APP_NAME}`;
  const body = asRecord(await getJson(fetchImpl, url));
  const track = mapTrack(body?.data);
  if (!track) {
    throw new AudiusError(`Audius track ${trackId} was not found`);
  }
  return track;
}

/**
 * Resolve the signed stream URL for a track. Audius normally answers this
 * endpoint with a 302; no_redirect=true returns { data: <final URL> } as
 * JSON instead. We never follow the redirect ourselves.
 */
export async function streamUrl(
  fetchImpl: FetchLike,
  trackId: string,
): Promise<string> {
  const url = `${API}/tracks/${encodeURIComponent(trackId)}/stream?app_name=${APP_NAME}&no_redirect=true`;
  const body = asRecord(await getJson(fetchImpl, url));
  const data = asString(body?.data);
  if (!data) {
    throw new AudiusError(`Audius gave no stream URL for ${trackId}`);
  }
  return data;
}
