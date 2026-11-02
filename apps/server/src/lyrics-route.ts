import { LrclibError, type LrclibProvider } from "./lrclib";

export type RouteResult = {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
};

const apiError = (code: string, message: string) => ({
  error: { code, message },
});

const nonBlank = (value: string | null, max: number) =>
  value !== null && /\S/.test(value) && value.length <= max;

/** GET /api/lyrics — validates the query before calling the provider. */
export async function handleLyricsRoute(
  url: URL,
  method: string,
  provider: LrclibProvider,
): Promise<RouteResult | null> {
  if (url.pathname !== "/api/lyrics") return null;
  if (method !== "GET")
    return {
      status: 405,
      headers: { Allow: "GET" },
      body: apiError("METHOD_NOT_ALLOWED", "Use GET."),
    };
  const trackName = url.searchParams.get("track_name");
  const artistName = url.searchParams.get("artist_name");
  const albumName = url.searchParams.get("album_name") ?? "";
  const durationRaw = url.searchParams.get("duration_ms");
  const durationMs = durationRaw === null ? NaN : Number(durationRaw);
  if (
    !nonBlank(trackName, 300) ||
    !nonBlank(artistName, 300) ||
    albumName.length > 300 ||
    !Number.isInteger(durationMs) ||
    durationMs < 1000 ||
    durationMs > 3_600_000
  )
    return {
      status: 400,
      body: apiError(
        "BAD_REQUEST",
        "Provide track_name, artist_name, optional album_name and duration_ms between 1000 and 3600000.",
      ),
    };
  try {
    const body = await provider.lookup({
      trackName: trackName!,
      artistName: artistName!,
      albumName,
      durationMs,
    });
    return { status: 200, body };
  } catch (error) {
    if (error instanceof LrclibError) {
      const headers =
        error.retryAfterSeconds !== undefined
          ? { "Retry-After": String(error.retryAfterSeconds) }
          : undefined;
      const code =
        error.status === 429
          ? "RATE_LIMITED"
          : error.status === 504
            ? "TIMEOUT"
            : "UNAVAILABLE";
      return {
        status: error.status,
        headers,
        body: apiError(code, error.message),
      };
    }
    return {
      status: 502,
      body: apiError("UNAVAILABLE", "The lyrics provider failed."),
    };
  }
}
