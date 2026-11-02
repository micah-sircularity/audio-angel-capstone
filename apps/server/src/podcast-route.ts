import { TaddyError, type TaddyProvider } from "./taddy";
import type { RouteResult } from "./lyrics-route";

const apiError = (code: string, message: string) => ({
  error: { code, message },
});

const nonBlank = (value: string | null, max: number) =>
  value !== null && /\S/.test(value) && value.length <= max;

/** GET /api/podcast-transcript — validates before calling the provider. */
export async function handlePodcastTranscriptRoute(
  url: URL,
  method: string,
  provider: TaddyProvider,
): Promise<RouteResult | null> {
  if (url.pathname !== "/api/podcast-transcript") return null;
  if (method !== "GET")
    return {
      status: 405,
      headers: { Allow: "GET" },
      body: apiError("METHOD_NOT_ALLOWED", "Use GET."),
    };
  const showName = url.searchParams.get("show_name");
  const episodeName = url.searchParams.get("episode_name");
  const durationRaw = url.searchParams.get("duration_ms");
  const durationMs = durationRaw === null ? NaN : Number(durationRaw);
  if (
    !nonBlank(showName, 200) ||
    !nonBlank(episodeName, 200) ||
    !Number.isInteger(durationMs) ||
    durationMs <= 0 ||
    durationMs > 21_600_000
  )
    return {
      status: 400,
      body: apiError(
        "BAD_REQUEST",
        "Provide show_name, episode_name and duration_ms up to 6 hours.",
      ),
    };
  try {
    const body = await provider.transcript({
      showName: showName!,
      episodeName: episodeName!,
      durationMs,
    });
    return { status: 200, body };
  } catch (error) {
    if (error instanceof TaddyError) {
      if (error.message === "not-configured")
        return {
          status: 503,
          body: apiError(
            "NOT_CONFIGURED",
            "Podcast transcripts aren't configured.",
          ),
        };
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
      body: apiError("UNAVAILABLE", "The transcript provider failed."),
    };
  }
}
