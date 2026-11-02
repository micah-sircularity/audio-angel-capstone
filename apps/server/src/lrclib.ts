import type {
  LyricsLookupRequest,
  LyricsLookupResponse,
} from "@audio-angel/contracts";
import { parseLrc, toLyricSpans } from "@audio-angel/filters";

export type LrclibFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export class LrclibError extends Error {
  constructor(
    message: string,
    readonly status: 429 | 502 | 503 | 504,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

const normalize = (text: string) =>
  text.normalize("NFKC").toLocaleLowerCase("en").trim().replace(/\s+/g, " ");

const parseRetryAfter = (value: string | null, now: number): number => {
  if (!value) return 60;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  if (Number.isFinite(date))
    return Math.max(1, Math.ceil((date - now) / 1000));
  return 60;
};

export class LrclibProvider {
  private cooldownUntil = 0;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  constructor(
    private readonly deps: { fetch: LrclibFetch; now?: () => number; timeoutMs?: number },
  ) {
    this.now = deps.now ?? Date.now;
    this.timeoutMs = deps.timeoutMs ?? 10_000;
  }
  async lookup(
    request: LyricsLookupRequest,
  ): Promise<LyricsLookupResponse> {
    const now = this.now();
    if (now < this.cooldownUntil)
      throw new LrclibError(
        "Lyrics provider rate limit is still cooling down.",
        429,
        Math.ceil((this.cooldownUntil - now) / 1000),
      );
    const query = new URLSearchParams({
      track_name: request.trackName,
      artist_name: request.artistName,
      duration: String(request.durationMs / 1000),
    });
    if (request.albumName.trim())
      query.set("album_name", request.albumName);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let text: string;
    try {
      const response = await this.deps.fetch(
        `https://lrclib.net/api/get?${query.toString()}`,
        {
          headers: {
            "User-Agent":
              "Audio Angel v0.1 (https://github.com/micah-sircularity/audio-angel)",
            Accept: "application/json",
          },
          redirect: "error",
          cache: "no-store",
          signal: controller.signal,
        },
      );
      if (response.status === 404)
        return {
          source: "lrclib",
          status: "not-found",
          recording: null,
          spans: [],
        };
      if (response.status === 429 || response.status === 503) {
        const retryAfter = parseRetryAfter(
          response.headers.get("retry-after"),
          this.now(),
        );
        this.cooldownUntil = this.now() + retryAfter * 1000;
        throw new LrclibError(
          "The lyrics provider asked us to slow down. Retry shortly.",
          response.status,
          retryAfter,
        );
      }
      if (!response.ok)
        throw new LrclibError("The lyrics provider returned an error.", 502);
      const type = response.headers.get("content-type") ?? "";
      if (type && !type.includes("json"))
        throw new LrclibError(
          "The lyrics provider returned malformed data.",
          502,
        );
      // Guard against unexpectedly large payloads before decoding.
      const length = Number(response.headers.get("content-length"));
      if (Number.isFinite(length) && length > 1_048_576)
        throw new LrclibError("The lyrics response was too large.", 502);
      try {
        // The deadline must cover the body read too, not just the fetch.
        text = await Promise.race([
          response.text(),
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            );
          }),
        ]);
      } catch {
        if (controller.signal.aborted)
          throw new LrclibError("Lyrics lookup timed out.", 504);
        throw new LrclibError("The lyrics provider failed mid-response.", 502);
      }
      if (text.length > 1_048_576)
        throw new LrclibError("The lyrics response was too large.", 502);
    } catch (error) {
      if (error instanceof LrclibError) throw error;
      if (controller.signal.aborted)
        throw new LrclibError("Lyrics lookup timed out.", 504);
      throw new LrclibError("Could not reach the lyrics provider.", 502);
    } finally {
      clearTimeout(timer);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new LrclibError("The lyrics provider returned malformed data.", 502);
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new LrclibError("The lyrics provider returned malformed data.", 502);
    const record = raw as Record<string, unknown>;
    const durationMs =
      typeof record.duration === "number" && Number.isFinite(record.duration)
        ? Math.round(record.duration * 1000)
        : 0;
    if (
      !record ||
      !Number.isSafeInteger(record.id) ||
      (record.id as number) < 0 ||
      typeof record.trackName !== "string" ||
      typeof record.artistName !== "string" ||
      typeof record.albumName !== "string" ||
      !Number.isSafeInteger(durationMs) ||
      durationMs <= 0 ||
      typeof record.instrumental !== "boolean" ||
      (record.syncedLyrics !== null && typeof record.syncedLyrics !== "string")
    )
      throw new LrclibError("The lyrics provider returned malformed data.", 502);
    const recording = {
      id: record.id as number,
      trackName: record.trackName as string,
      artistName: record.artistName as string,
      albumName: record.albumName as string,
      durationMs,
    };
    const matches =
      normalize(record.trackName) === normalize(request.trackName) &&
      normalize(record.artistName) === normalize(request.artistName) &&
      (!request.albumName.trim() ||
        normalize(record.albumName) === normalize(request.albumName)) &&
      Math.abs(recording.durationMs - request.durationMs) <= 2000;
    if (!matches)
      return {
        source: "lrclib",
        status: "not-found",
        recording: null,
        spans: [],
      };
    if (record.instrumental)
      return {
        source: "lrclib",
        status: "instrumental",
        recording,
        spans: [],
      };
    const synced =
      typeof record.syncedLyrics === "string" && record.syncedLyrics.trim()
        ? toLyricSpans(parseLrc(record.syncedLyrics), request.durationMs)
        : [];
    // Blank-only cue lists carry no lyric text: report as unsynced while
    // preserving blank gaps whenever real text lines exist.
    if (!synced.length || !synced.some((span) => span.text.trim()))
      return {
        source: "lrclib",
        status: "unsynced",
        recording,
        spans: [],
      };
    const spans = synced.map((span) => ({
      ...span,
      timing: "line" as const,
    }));
    return {
      source: "lrclib",
      status: "synced",
      recording,
      // synced is non-empty past the guard above.
      spans: spans as [typeof spans[number], ...(typeof spans)],
    };
  }
}
