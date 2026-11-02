import * as Schema from "effect/Schema";
import {
  LyricsLookupResponse,
  type LyricsLookupRequest,
} from "@audio-angel/contracts";

export class LyricsRequestError extends Error {}

type LyricsFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

const STATUS_MESSAGES: Record<number, string> = {
  400: "The lyrics request was invalid.",
  429: "The lyrics provider asked us to slow down. Retry shortly.",
  503: "The lyrics provider is temporarily unavailable. Retry shortly.",
  504: "The lyrics provider timed out. Retry shortly.",
};

/**
 * Same-origin lookup through the app server. Track metadata only — no
 * Spotify tokens, audio or account data are sent. No caching or polling.
 */
export async function fetchLyrics(
  request: LyricsLookupRequest,
  deps: {
    fetch?: LyricsFetch;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<LyricsLookupResponse> {
  const send = deps.fetch ?? ((input, init) => fetch(input, init));
  const deadline = deps.timeoutMs ?? 15_000;
  const caller = deps.signal;
  if (caller?.aborted) throw new LyricsRequestError("Cancelled.");
  const controller = new AbortController();
  let timedOut = false;
  const onCallerAbort = () => controller.abort();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, deadline);
  caller?.addEventListener("abort", onCallerAbort, { once: true });
  try {
    const query = new URLSearchParams({
      track_name: request.trackName,
      artist_name: request.artistName,
      album_name: request.albumName,
      duration_ms: String(request.durationMs),
    });
    let response: Response;
    try {
      response = await send(`/api/lyrics?${query.toString()}`, {
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
      });
    } catch {
      if (caller?.aborted) throw new LyricsRequestError("Cancelled.");
      if (timedOut)
        throw new LyricsRequestError("The lyrics request timed out.");
      throw new LyricsRequestError("Could not reach the lyrics service.");
    }
    if (!response.ok)
      throw new LyricsRequestError(
        STATUS_MESSAGES[response.status] ??
          "The lyrics service could not answer. Retry shortly.",
      );
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      if (caller?.aborted) throw new LyricsRequestError("Cancelled.");
      if (timedOut)
        throw new LyricsRequestError("The lyrics request timed out.");
      throw new LyricsRequestError("The lyrics response was malformed.");
    }
    return Schema.decodeUnknownSync(LyricsLookupResponse)(payload);
  } catch (error) {
    if (error instanceof LyricsRequestError) throw error;
    throw new LyricsRequestError("The lyrics response was malformed.");
  } finally {
    clearTimeout(timer);
    caller?.removeEventListener("abort", onCallerAbort);
  }
}
