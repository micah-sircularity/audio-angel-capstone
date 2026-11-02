import { describe, expect, it, vi } from "vitest";
import { fetchLyrics, LyricsRequestError } from "./lyrics";

const request = {
  trackName: "Song & Dance",
  artistName: "The Artist",
  albumName: "",
  durationMs: 200000,
};
const recording = {
  id: 7,
  trackName: "Song & Dance",
  artistName: "The Artist",
  albumName: "Album",
  durationMs: 200000,
};
const synced = {
  source: "lrclib",
  status: "synced",
  recording,
  spans: [{ startMs: 0, endMs: 1000, text: "a", timing: "line" }],
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const call = (
  impl?: (input: string, init?: RequestInit) => Promise<Response>,
  extra: { signal?: AbortSignal; timeoutMs?: number } = {},
) => {
  const fetcher = vi.fn(impl ?? (() => Promise.resolve(json(synced))));
  return {
    fetcher,
    result: fetchLyrics(request, { fetch: fetcher, ...extra }),
  };
};
describe("fetchLyrics", () => {
  it("sends an encoded same-origin query with no credentials", async () => {
    const { fetcher, result } = call();
    await result;
    const [input, init] = fetcher.mock.calls[0];
    const sent = new URL(`http://local${input}`);
    expect(sent.pathname).toBe("/api/lyrics");
    expect(sent.searchParams.get("track_name")).toBe("Song & Dance");
    expect(sent.searchParams.get("artist_name")).toBe("The Artist");
    expect(sent.searchParams.get("album_name")).toBe("");
    expect(sent.searchParams.get("duration_ms")).toBe("200000");
    expect(init?.cache).toBe("no-store");
    expect(init?.credentials).toBe("omit");
    expect(
      (init?.headers as Record<string, string> | undefined)?.Authorization,
    ).toBeUndefined();
  });
  it("decodes each response status", async () => {
    for (const body of [
      synced,
      { ...synced, status: "unsynced", spans: [] },
      { ...synced, status: "instrumental", spans: [] },
      { ...synced, status: "not-found", recording: null, spans: [] },
    ]) {
      const { result } = call(() => Promise.resolve(json(body)));
      await expect(result).resolves.toEqual(body);
    }
  });
  it("rejects malformed payloads without leaking them", async () => {
    const { result } = call(() =>
      Promise.resolve(json({ source: "lrclib", status: "mystery" })),
    );
    await expect(result).rejects.toThrow("malformed");
  });
  it("maps HTTP failures to fixed messages", async () => {
    for (const [status, text] of [
      [400, "invalid"],
      [429, "slow down"],
      [503, "unavailable"],
      [500, "could not answer"],
    ] as const) {
      const { result } = call(() =>
        Promise.resolve(
          json({ error: { message: "provider secret" } }, status),
        ),
      );
      await expect(result).rejects.toThrow(text);
    }
  });
  it("rejects on network failure and timeout", async () => {
    const { result } = call(() => Promise.reject(new Error("offline")));
    await expect(result).rejects.toThrow("Could not reach");
    const { result: slow } = call(
      (_input, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
      { timeoutMs: 25 },
    );
    await expect(slow).rejects.toThrow("timed out");
  });
  it("rejects a pre-aborted caller signal without fetching", async () => {
    const caller = new AbortController();
    caller.abort();
    const { fetcher, result } = call(undefined, { signal: caller.signal });
    await expect(result).rejects.toThrow("Cancelled");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("times out while reading the response body", async () => {
    const { result } = call(
      (_input, init) =>
        Promise.resolve(
          new Response(new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener("abort", () =>
                controller.error(new Error("aborted")),
              );
            },
          })),
        ),
      { timeoutMs: 25 },
    );
    await expect(result).rejects.toThrow("timed out");
  });
  it("aborts on a caller signal", async () => {
    const caller = new AbortController();
    const { result } = call(
      (_input, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
      { signal: caller.signal },
    );
    caller.abort();
    await expect(result).rejects.toThrow(LyricsRequestError);
  });
});
