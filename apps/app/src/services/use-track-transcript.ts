import { useEffect, useMemo, useState } from "react";
import type {
  PodcastTranscriptRequest,
  PodcastTranscriptResponse,
} from "@audio-angel/contracts";
import { fetchPodcastTranscript } from "./podcast-transcript";
import type { PlaybackSnapshot } from "./spotify/playback";

export type TranscriptLookupState = {
  request: PodcastTranscriptRequest | null;
  data: PodcastTranscriptResponse | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  retry: () => void;
};

/** Episode transcripts via Taddy. Spotify puts the show name in track.album. */
export function useEpisodeTranscript(
  snapshot: PlaybackSnapshot,
): TranscriptLookupState {
  const track = snapshot.track;
  const request = useMemo<PodcastTranscriptRequest | null>(() => {
    if (
      !track ||
      !track.uri.startsWith("spotify:episode:") ||
      track.album === "Podcast" ||
      snapshot.durationMs <= 0 ||
      snapshot.durationMs > 21_600_000
    )
      return null;
    return {
      showName: track.album,
      episodeName: track.name,
      durationMs: Math.round(snapshot.durationMs),
    };
    // Stable metadata fields prevent position/poll ticks from refetching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.uri, track?.name, track?.album, snapshot.durationMs]);
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify([track?.uri, request, retry]);
  const [result, setResult] = useState<{
    key: string;
    data: PodcastTranscriptResponse | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    void fetchPodcastTranscript(request, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted)
          setResult({ key, data, error: null });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            key,
            data: null,
            error:
              error instanceof Error
                ? error.message
                : "The transcript could not be loaded. Retry.",
          });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key captures request identity and retries.
  }, [key]);
  const fresh = result?.key === key ? result : null;
  return {
    request,
    data: fresh?.data ?? null,
    error: fresh?.error ?? null,
    status: !request ? "idle" : !fresh ? "loading" : fresh.error ? "error" : "ready",
    retry: () => setRetry((n) => n + 1),
  };
}
