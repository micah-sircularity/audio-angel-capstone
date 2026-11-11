import { describe, expect, it, vi } from "vitest";
import { decide, JevError, type DecisionState } from "./jev";
import { categoryQuestions } from "./questions";
import type { FetchLike } from "./safeFetch";

const state: DecisionState = {
  kind: "speech",
  instruction: "Judge only the text in 'line'.",
  before: "",
  line: "hello there",
  after: "",
};
const questions = { q: categoryQuestions().profanity };

const okResponse = (noul = 0.87) =>
  new Response(
    JSON.stringify({
      answers: { q: { type: "noul", noul }, other: { type: "bool" } },
      usage: { tokens: 12 },
    }),
    { status: 200 },
  );

const recordSleep = () => {
  const delays: number[] = [];
  return {
    delays,
    sleep: (ms: number) => {
      delays.push(ms);
      return Promise.resolve();
    },
  };
};

describe("decide", () => {
  it("posts state+questions and normalizes noul answers", async () => {
    const fetchImpl: FetchLike = vi.fn(async () => okResponse());
    const result = await decide(fetchImpl, "key", state, questions, {
      sleep: () => Promise.resolve(),
    });
    expect(result.answers).toEqual({ q: 0.87 });
    expect(result.usage).toEqual({ tokens: 12 });
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/alpha/decisions");
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer key",
    );
    const sent = JSON.parse(String(init?.body));
    expect(sent.model).toBe("typesafe/jev-1.14");
    expect(sent.state.line).toBe("hello there");
    expect(sent.questions.q.type).toBe("noul");
  });

  it("retries 429 with backoff and honors Retry-After", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("busy", {
          status: 429,
          headers: { "retry-after": "3" },
        });
      }
      return okResponse(0.2);
    };
    const { delays, sleep } = recordSleep();
    const result = await decide(fetchImpl, "key", state, questions, { sleep });
    expect(calls).toBe(2);
    expect(result.answers.q).toBe(0.2);
    // Backoff floor 1s raised to the 3s Retry-After hint.
    expect(delays).toEqual([3_000]);
  });

  it("retries 402 only for the in-flight budget limit", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(
          JSON.stringify({
            error: {
              metadata: { limit_source: "openrouter_in_flight_budget" },
            },
          }),
          { status: 402 },
        );
      }
      return okResponse(0.5);
    };
    const { sleep } = recordSleep();
    const result = await decide(fetchImpl, "key", state, questions, { sleep });
    expect(calls).toBe(2);
    expect(result.answers.q).toBe(0.5);
  });

  it("fails immediately on other 402s and non-retryable errors", async () => {
    const fetchImpl: FetchLike = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "insufficient credits" } }), {
        status: 402,
      }),
    );
    const error = await decide(fetchImpl, "key", state, questions, {
      sleep: () => Promise.resolve(),
    }).catch((e) => e);
    expect(error).toBeInstanceOf(JevError);
    expect(error.status).toBe(402);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("throws when a requested answer is missing or not noul", async () => {
    const fetchImpl: FetchLike = async () =>
      new Response(
        JSON.stringify({ answers: { q: { type: "bool", bool: true } } }),
        { status: 200 },
      );
    await expect(
      decide(fetchImpl, "key", state, questions, {
        sleep: () => Promise.resolve(),
      }),
    ).rejects.toThrow(/missing or not a noul/);
  });
});
