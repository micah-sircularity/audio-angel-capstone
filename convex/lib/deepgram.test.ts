import { describe, expect, it, vi } from "vitest";
import { DeepgramError, transcribeUrl } from "./deepgram";
import type { FetchLike } from "./safeFetch";

const noSleep = { sleep: () => Promise.resolve() };

const word = (
  w: string,
  start: number,
  end: number,
  punctuated?: string,
) => ({ word: w, punctuated_word: punctuated ?? w, start, end, confidence: 0.99 });

const body = (payload: unknown) =>
  new Response(JSON.stringify(payload), { status: 200 });

describe("transcribeUrl", () => {
  it("maps utterances to millisecond segments", async () => {
    const fetchImpl: FetchLike = vi.fn(async () =>
      body({
        metadata: { duration: 61.5 },
        results: {
          channels: [
            { alternatives: [{ words: [word("Hello", 0, 1), word("world", 1, 2.4, "world.")] }] },
          ],
          utterances: [
            {
              start: 0,
              end: 2.4,
              transcript: "Hello world.",
              words: [word("Hello", 0, 1), word("world", 1, 2.4, "world.")],
            },
          ],
        },
      }),
    );
    const result = await transcribeUrl(fetchImpl, "key", "https://audio/x.mp3", noSleep);
    expect(result.durationMs).toBe(61_500);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({
      startMs: 0,
      endMs: 2_400,
      text: "Hello world.",
    });
    expect(result.segments[0].words.map((w) => w.text)).toEqual([
      "Hello",
      "world.",
    ]);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("model=nova-3");
    expect(url).toContain("utterances=true");
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Token key",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      url: "https://audio/x.mp3",
    });
  });

  it("groups channel words into ~8s segments when utterances are absent", async () => {
    const words = [
      word("one", 0, 1, "one"),
      word("two", 1, 2, "two."),
      word("three", 2, 4, "three"),
      word("four", 4, 6, "four"),
      word("five", 6, 10, "five"),
      word("six", 10, 11, "six."),
    ];
    const fetchImpl: FetchLike = async () =>
      body({
        metadata: { duration: 11 },
        results: {
          channels: [{ alternatives: [{ words }] }],
          // no utterances at all
        },
      });
    const result = await transcribeUrl(fetchImpl, "key", "https://a", noSleep);
    // "one two." breaks on punctuation, "three four five" hits the ~8s cap,
    // "six." is the tail flush.
    expect(result.segments.map((s) => s.text)).toEqual([
      "one two.",
      "three four five",
      "six.",
    ]);
    expect(
      result.segments.every(
        (s) => s.endMs - s.startMs <= 8_500 || s.words.length === 1,
      ),
    ).toBe(true);
  });

  it("splits segments longer than 45s near punctuation", async () => {
    // One 60s utterance with a sentence break at ~30s.
    const words = [
      word("alpha", 0, 29, "alpha"),
      word("beta", 29, 30, "beta."),
      word("gamma", 30, 59, "gamma"),
      word("delta", 59, 60, "delta."),
    ];
    const fetchImpl: FetchLike = async () =>
      body({
        metadata: { duration: 60 },
        results: {
          channels: [{ alternatives: [{ words }] }],
          utterances: [
            { start: 0, end: 60, transcript: "alpha beta. gamma delta.", words },
          ],
        },
      });
    const result = await transcribeUrl(fetchImpl, "key", "https://a", noSleep);
    expect(result.segments.length).toBe(2);
    expect(result.segments[0].text).toBe("alpha beta.");
    expect(result.segments[1].text).toBe("gamma delta.");
    expect(
      result.segments.every((s) => s.endMs - s.startMs <= 45_000),
    ).toBe(true);
  });

  it("retries 429/5xx then succeeds", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      if (calls === 1) return new Response("slow down", { status: 429 });
      return body({
        metadata: { duration: 1 },
        results: {
          channels: [{ alternatives: [{ words: [word("hi", 0, 1, "hi.")] }] }],
          utterances: [
            { start: 0, end: 1, transcript: "hi.", words: [word("hi", 0, 1, "hi.")] },
          ],
        },
      });
    };
    const result = await transcribeUrl(fetchImpl, "key", "https://a", noSleep);
    expect(calls).toBe(2);
    expect(result.segments[0].text).toBe("hi.");
  });

  it("fails immediately on other 4xx with status", async () => {
    const fetchImpl: FetchLike = vi.fn(async () =>
      new Response("bad request", { status: 400 }),
    );
    const error = await transcribeUrl(fetchImpl, "key", "https://a", noSleep).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(DeepgramError);
    expect(error.status).toBe(400);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("throws a no-speech error when zero words come back", async () => {
    const fetchImpl: FetchLike = async () =>
      body({
        metadata: { duration: 3 },
        results: {
          channels: [{ alternatives: [{ words: [] }] }],
          utterances: [],
        },
      });
    const error = await transcribeUrl(fetchImpl, "key", "https://a", noSleep).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(DeepgramError);
    expect(error.code).toBe("no-speech");
  });
});
