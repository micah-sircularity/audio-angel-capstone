import { describe, expect, it, vi } from "vitest";
import { LrclibError, LrclibProvider } from "./lrclib";
import { handleLyricsRoute } from "./lyrics-route";

const request = {
  trackName: "Song",
  artistName: "Artist",
  albumName: "Album",
  durationMs: 200000,
};
const record = (overrides: Record<string, unknown> = {}) => ({
  id: 42,
  trackName: "Song",
  artistName: "Artist",
  albumName: "Album",
  duration: 200,
  instrumental: false,
  plainLyrics: "unused",
  syncedLyrics: "[00:01.00]First line\n[00:02.00]Second line",
  ...overrides,
});
const json = (body: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
function setup(
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>,
  nowStart = 1_000_000,
) {
  const fetcher = vi.fn(
    fetchImpl ?? (() => Promise.resolve(json(record()))),
  );
  let now = nowStart;
  const provider = new LrclibProvider({
    fetch: fetcher,
    now: () => now,
  });
  return { provider, fetcher, advance: (ms: number) => (now += ms) };
}
const url = (query = "") =>
  new URL(`http://server/api/lyrics${query ? `?${query}` : ""}`);
const query =
  "track_name=Song&artist_name=Artist&album_name=Album&duration_ms=200000";

describe("LrclibProvider", () => {
  it("requests the fixed endpoint with identifying User-Agent", async () => {
    const { provider, fetcher } = setup();
    await provider.lookup(request);
    const [input, init] = fetcher.mock.calls[0];
    const sent = new URL(input as string);
    expect(`${sent.origin}${sent.pathname}`).toBe("https://lrclib.net/api/get");
    expect(sent.searchParams.get("track_name")).toBe("Song");
    expect(sent.searchParams.get("artist_name")).toBe("Artist");
    expect(sent.searchParams.get("album_name")).toBe("Album");
    expect(sent.searchParams.get("duration")).toBe("200");
    const headers = init?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toContain("Audio Angel");
    expect(headers.Authorization).toBeUndefined();
    expect(init?.redirect).toBe("error");
    expect(init?.cache).toBe("no-store");
    expect(init?.credentials).toBeUndefined();
  });
  it("omits a blank album parameter", async () => {
    const { provider, fetcher } = setup();
    await provider.lookup({ ...request, albumName: " " });
    const sent = new URL(fetcher.mock.calls[0][0] as string);
    expect(sent.searchParams.has("album_name")).toBe(false);
  });
  it("returns synced spans from LRC text", async () => {
    const { provider } = setup();
    const result = await provider.lookup(request);
    expect(result.status).toBe("synced");
    expect(result.recording).toEqual({
      id: 42,
      trackName: "Song",
      artistName: "Artist",
      albumName: "Album",
      durationMs: 200000,
    });
    expect(result.spans).toEqual([
      { startMs: 1000, endMs: 2000, text: "First line", timing: "line" },
      { startMs: 2000, endMs: 200000, text: "Second line", timing: "line" },
    ]);
  });
  it("reports unsynced and instrumental records", async () => {
    const { provider } = setup(() =>
      Promise.resolve(json(record({ syncedLyrics: null }))),
    );
    expect((await provider.lookup(request)).status).toBe("unsynced");
    const instrumental = setup(() =>
      Promise.resolve(json(record({ instrumental: true }))),
    );
    expect((await instrumental.provider.lookup(request)).status).toBe(
      "instrumental",
    );
    const blankOnly = setup(() =>
      Promise.resolve(json(record({ syncedLyrics: "[00:01.00]\n[00:02.00]" }))),
    );
    expect((await blankOnly.provider.lookup(request)).status).toBe("unsynced");
    const metaOnly = setup(() =>
      Promise.resolve(
        json(record({ syncedLyrics: "[ti:x]\n[ar:y]\nplain text" })),
      ),
    );
    expect((await metaOnly.provider.lookup(request)).status).toBe("unsynced");
    const noLrc = setup(() =>
      Promise.resolve(json(record({ syncedLyrics: "just words" }))),
    );
    expect((await noLrc.provider.lookup(request)).status).toBe("unsynced");
    const mixed = setup(() =>
      Promise.resolve(
        json(record({ syncedLyrics: "[00:01.00]\n[00:02.00]Real line" })),
      ),
    );
    const mixedResult = await mixed.provider.lookup(request);
    expect(mixedResult.status).toBe("synced");
    expect(mixedResult.spans.some((s) => s.text === "")).toBe(true);
  });
  it("reports 404 and mismatched records as not-found", async () => {
    const { provider } = setup(() =>
      Promise.resolve(new Response(null, { status: 404 })),
    );
    expect(await provider.lookup(request)).toEqual({
      source: "lrclib",
      status: "not-found",
      recording: null,
      spans: [],
    });
    const wrongTitle = setup(() =>
      Promise.resolve(json(record({ trackName: "Other" }))),
    );
    expect((await wrongTitle.provider.lookup(request)).status).toBe(
      "not-found",
    );
    const wrongArtist = setup(() =>
      Promise.resolve(json(record({ artistName: "Someone Else" }))),
    );
    expect((await wrongArtist.provider.lookup(request)).status).toBe(
      "not-found",
    );
    const wrongDuration = setup(() =>
      Promise.resolve(json(record({ duration: 205 }))),
    );
    expect((await wrongDuration.provider.lookup(request)).status).toBe(
      "not-found",
    );
    const close = setup(() =>
      Promise.resolve(json(record({ duration: 201.5 }))),
    );
    expect((await close.provider.lookup(request)).status).toBe("synced");
    const wrongAlbum = setup(() =>
      Promise.resolve(json(record({ albumName: "Elsewhere" }))),
    );
    expect((await wrongAlbum.provider.lookup(request)).status).toBe(
      "not-found",
    );
  });
  it("normalizes case and whitespace when matching", async () => {
    const { provider } = setup(() =>
      Promise.resolve(
        json(record({ trackName: "  SONG  ", artistName: "artist" })),
      ),
    );
    expect((await provider.lookup(request)).status).toBe("synced");
  });
  it("rejects malformed and oversized responses", async () => {
    const badJson = setup(() =>
      Promise.resolve(new Response("not json", { status: 200 })),
    );
    await expect(badJson.provider.lookup(request)).rejects.toThrow(
      LrclibError,
    );
    const missing = setup(() =>
      Promise.resolve(json({ id: 1, trackName: "Song" })),
    );
    await expect(missing.provider.lookup(request)).rejects.toThrow("malformed");
    // Null, array and scalar JSON bodies are all malformed, never TypeErrors.
    for (const body of ["null", "[]", "5", '"text"']) {
      const weird = setup(() =>
        Promise.resolve(new Response(body, { status: 200 })),
      );
      await expect(weird.provider.lookup(request)).rejects.toThrow(
        "malformed",
      );
    }
    const oversized = setup(() =>
      Promise.resolve(
        json(record(), 200, { "Content-Length": String(2_000_000) }),
      ),
    );
    await expect(oversized.provider.lookup(request)).rejects.toThrow(
      "too large",
    );
  });
  it("clears the request timer when fetch rejects", async () => {
    vi.useFakeTimers();
    try {
      const { provider } = setup(() =>
        Promise.reject(new Error("socket reset")),
      );
      await expect(provider.lookup(request)).rejects.toThrow("Could not reach");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("maps a mid-body read rejection to a safe 502 and an abort to 504", async () => {
    // Stub text() to fail after headers pass.
    const badBody = new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const failedText = setup(() =>
      Promise.resolve(
        Object.assign(badBody, {
          text: () => Promise.reject(new Error("stream died")),
        }),
      ),
    );
    await expect(failedText.provider.lookup(request)).rejects.toThrow(
      "mid-response",
    );
    const abortedBody = setup(() =>
      Promise.resolve(
        Object.assign(
          new Response("{}", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
          {
            text: () => new Promise<string>(() => {}),
          },
        ),
      ),
    );
    const timed = new LrclibProvider({
      fetch: abortedBody.fetcher,
      timeoutMs: 30,
    });
    await expect(timed.lookup(request)).rejects.toThrow("timed out");
  });
  it("times out an unresolved provider request", async () => {
    const stalled = new LrclibProvider({
      fetch: (_input, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
      timeoutMs: 30,
    });
    await expect(stalled.lookup(request)).rejects.toThrow("timed out");
  });
  it("enforces a Retry-After cooldown without further upstream calls", async () => {
    const { provider, fetcher, advance } = setup(() =>
      Promise.resolve(json({}, 429, { "Retry-After": "30" })),
    );
    await expect(provider.lookup(request)).rejects.toThrow("slow down");
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValueOnce(json(record()));
    await expect(provider.lookup(request)).rejects.toThrow("cooling down");
    expect(fetcher).toHaveBeenCalledTimes(1); // No upstream call made.
    advance(30_001);
    expect((await provider.lookup(request)).status).toBe("synced");
  });
  it("parses HTTP-date Retry-After and maps other failures safely", async () => {
    const now = 1_000_000;
    const date = setup(
      () =>
        Promise.resolve(
          json({}, 503, {
            "Retry-After": new Date(now + 45_000).toUTCString(),
          }),
        ),
      now,
    );
    try {
      await date.provider.lookup(request);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(LrclibError);
      expect((error as LrclibError).status).toBe(503);
      expect((error as LrclibError).retryAfterSeconds).toBe(45);
    }
    const server = setup(() => Promise.resolve(json({}, 500)));
    await expect(server.provider.lookup(request)).rejects.toThrow("error");
    const down = setup(() => Promise.reject(new Error("socket reset")));
    await expect(down.provider.lookup(request)).rejects.toThrow(
      "Could not reach",
    );
  });
});
describe("handleLyricsRoute", () => {
  const { provider } = setup();
  it("ignores other paths", async () => {
    expect(await handleLyricsRoute(new URL("http://x/api/other"), "GET", provider)).toBeNull();
  });
  it("rejects non-GET methods with Allow", async () => {
    const result = await handleLyricsRoute(url(query), "POST", provider);
    expect(result?.status).toBe(405);
    expect(result?.headers?.Allow).toBe("GET");
  });
  it("validates the query before any provider call", async () => {
    const spy = vi.fn(() => Promise.resolve(json(record())));
    const p = new LrclibProvider({ fetch: spy });
    for (const bad of [
      "track_name=&artist_name=A&duration_ms=2000",
      "artist_name=A&duration_ms=2000",
      "track_name=S&artist_name=A&duration_ms=abc",
      "track_name=S&artist_name=A&duration_ms=500",
      `track_name=${"x".repeat(301)}&artist_name=A&duration_ms=2000`,
      "track_name=S&artist_name=A&album_name=" +
        "x".repeat(301) +
        "&duration_ms=2000",
    ]) {
      const result = await handleLyricsRoute(url(bad), "GET", p);
      expect(result?.status).toBe(400);
    }
    expect(spy).not.toHaveBeenCalled();
  });
  it("returns provider results and mapped errors", async () => {
    const ok = await handleLyricsRoute(url(query), "GET", provider);
    expect(ok?.status).toBe(200);
    expect((ok?.body as { status: string }).status).toBe("synced");
    const failing = new LrclibProvider({
      fetch: () => Promise.resolve(json({}, 429, { "Retry-After": "7" })),
    });
    const limited = await handleLyricsRoute(url(query), "GET", failing);
    expect(limited?.status).toBe(429);
    expect(limited?.headers?.["Retry-After"]).toBe("7");
    const missing = new LrclibProvider({
      fetch: () => Promise.resolve(new Response(null, { status: 404 })),
    });
    const notFound = await handleLyricsRoute(url(query), "GET", missing);
    expect(notFound?.status).toBe(200);
    expect((notFound?.body as { status: string }).status).toBe("not-found");
    const timeout = new LrclibProvider({
      fetch: () => Promise.reject(new Error("hang")),
      timeoutMs: 10,
    });
    const timed = await handleLyricsRoute(url(query), "GET", timeout);
    expect(timed?.status).toBe(502);
    const broken = new LrclibProvider({
      fetch: () => Promise.resolve(json({}, 500)),
    });
    const failed = await handleLyricsRoute(url(query), "GET", broken);
    expect(failed?.status).toBe(502);
    const hanging = new LrclibProvider({
      fetch: (_input, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
      timeoutMs: 20,
    });
    const timedOut = await handleLyricsRoute(url(query), "GET", hanging);
    expect(timedOut?.status).toBe(504);
  });
});
