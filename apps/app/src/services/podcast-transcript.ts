import * as Schema from "effect/Schema";
import {
  PodcastTranscriptResponse,
  type PodcastTranscriptRequest,
} from "@audio-angel/contracts";

export class TranscriptRequestError extends Error {}

type TranscriptFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

const STATUS_MESSAGES: Record<number, string> = {
  400: "The transcript request was invalid.",
  429: "The transcript provider asked us to slow down. Retry shortly.",
  503: "Podcast transcripts are temporarily unavailable. Retry shortly.",
  504: "The transcript provider timed out. Retry shortly.",
};

/**
 * Same-origin podcast transcript lookup through the app server. Episode
 * metadata only — no Spotify tokens, audio or account data are sent.
 */
export async function fetchPodcastTranscript(
  request: PodcastTranscriptRequest,
  deps: {
    fetch?: TranscriptFetch;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<PodcastTranscriptResponse> {
  const send = deps.fetch ?? ((input, init) => fetch(input, init));
  const deadline = deps.timeoutMs ?? 15_000;
  const caller = deps.signal;
  if (caller?.aborted) throw new TranscriptRequestError("Cancelled.");
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
      show_name: request.showName,
      episode_name: request.episodeName,
      duration_ms: String(request.durationMs),
    });
    let response: Response;
    try {
      response = await send(`/api/podcast-transcript?${query.toString()}`, {
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
      });
    } catch {
      if (caller?.aborted) throw new TranscriptRequestError("Cancelled.");
      if (timedOut)
        throw new TranscriptRequestError("The transcript request timed out.");
      throw new TranscriptRequestError(
        "Could not reach the transcript service.",
      );
    }
    if (!response.ok)
      throw new TranscriptRequestError(
        STATUS_MESSAGES[response.status] ??
          "The transcript service could not answer. Retry shortly.",
      );
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      if (caller?.aborted) throw new TranscriptRequestError("Cancelled.");
      if (timedOut)
        throw new TranscriptRequestError("The transcript request timed out.");
      throw new TranscriptRequestError("The transcript response was malformed.");
    }
    return Schema.decodeUnknownSync(PodcastTranscriptResponse)(payload);
  } catch (error) {
    if (error instanceof TranscriptRequestError) throw error;
    throw new TranscriptRequestError("The transcript response was malformed.");
  } finally {
    clearTimeout(timer);
    caller?.removeEventListener("abort", onCallerAbort);
  }
}
