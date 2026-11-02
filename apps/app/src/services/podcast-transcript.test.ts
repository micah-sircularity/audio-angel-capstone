import { describe, expect, it, vi } from "vitest";
import {
  fetchPodcastTranscript,
  TranscriptRequestError,
} from "./podcast-transcript";

const request = {
  showName: "Value 4 Value",
  episodeName: "Episode One",
  durationMs: 3_600_000,
};
const episode = {
  taddyUuid: "ep-1",
  name: "Episode One",
  showName: "Value 4 Value",
  durationMs: 3_590_000,
  transcriptOrigin: "publisher",
};
const synced = {
  source: "taddy",
  status: "synced",
  episode,
  durationDeltaMs: 10_000,
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
    result: fetchPodcastTranscript(request, { fetch: fetcher, ...extra }),
  };
};

describe("fetchPodcastTranscript", () => {
  it("sends an encoded same-origin query with no credentials", async () => {
    const { fetcher, result } = call();
    await result;
    const [input, init] = fetcher.mock.calls[0];
    const sent = new URL(`http://local${input}`);
    expect(sent.pathname).toBe("/api/podcast-transcript");
    expect(sent.searchParams.get("show_name")).toBe("Value 4 Value");
    expect(sent.searchParams.get("episode_name")).toBe("Episode One");
    expect(sent.searchParams.get("duration_ms")).toBe("3600000");
    expect(init?.cache).toBe("no-store");
    expect(init?.credentials).toBe("omit");
    expect(init?.headers ?? {}).not.toHaveProperty("Authorization");
  });
  it("decodes every response status variant", async () => {
    for (const body of [
      synced,
      {
        source: "taddy",
        status: "not-found",
        episode: null,
        durationDeltaMs: null,
        spans: [],
      },
      {
        source: "taddy",
        status: "no-transcript",
        episode: { ...episode, transcriptOrigin: null },
        durationDeltaMs: 0,
        spans: [],
      },
      {
        source: "taddy",
        status: "requires-upgrade",
        episode: { ...episode, transcriptOrigin: "taddy" },
        durationDeltaMs: 0,
        spans: [],
      },
    ]) {
      const { result } = call(() => Promise.resolve(json(body)));
      await expect(result).resolves.toEqual(body);
    }
  });
  it("rejects malformed or inconsistent payloads", async () => {
    for (const body of [
      { source: "taddy", status: "synced", episode, durationDeltaMs: 0, spans: [] },
      { error: { message: "raw provider text" } },
      "nope",
    ]) {
      const { result } = call(() => Promise.resolve(json(body)));
      await expect(result).rejects.toBeInstanceOf(TranscriptRequestError);
    }
  });
  it("maps HTTP failures to safe messages", async () => {
    const { result } = call(() =>
      Promise.resolve(new Response("oops", { status: 429 })),
    );
    await expect(result).rejects.toMatchObject({
      message: "The transcript provider asked us to slow down. Retry shortly.",
    });
  });
  it("rejects a pre-aborted signal before fetching", async () => {
    const controller = new AbortController();
    controller.abort();
    const { fetcher, result } = call(undefined, { signal: controller.signal });
    await expect(result).rejects.toMatchObject({ message: "Cancelled." });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("maps a network failure and a caller abort", async () => {
    const { result } = call(() => Promise.reject(new Error("down")));
    await expect(result).rejects.toMatchObject({
      message: "Could not reach the transcript service.",
    });
    const controller = new AbortController();
    const aborted = call(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
      { signal: controller.signal },
    );
    controller.abort();
    await expect(aborted.result).rejects.toMatchObject({
      message: "Cancelled.",
    });
  });
  it("maps a deadline abort during the body read to a timeout", async () => {
    const { result } = call(
      (_input, init) =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener(
                "abort",
                () => reject(new Error("aborted")),
                { once: true },
              );
            }),
        } as Response),
      { timeoutMs: 20 },
    );
    await expect(result).rejects.toMatchObject({
      message: "The transcript request timed out.",
    });
  });
});
