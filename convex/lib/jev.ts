/**
 * OpenRouter Decisions API client for the Jev decision model
 * (typesafe/jev-1.14). One `decide` call judges a single transcript line
 * against a map of noul questions and returns a probability per question.
 * `fetch` is injected for testability.
 */

import type { FetchLike } from "./safeFetch";
import type { DecisionQuestion } from "./questions";

const DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
const MODEL = "typesafe/jev-1.14";
const TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 4;
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000];
const RETRY_AFTER_CAP_MS = 30_000;

/** Line-judgment state sent to the Decisions API. */
export type DecisionState = {
  kind: "music" | "speech";
  instruction: string;
  before: string;
  line: string;
  after: string;
};

export type DecideResult = {
  /** Noul probability per requested question key. */
  answers: Record<string, number>;
  /** Raw usage payload from the API, when present. */
  usage: unknown;
};

export class JevError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "JevError";
    this.status = status;
  }
}

type Sleep = (ms: number) => Promise<void>;
const defaultSleep: Sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;

const retryAfterMs = (res: Response): number | null => {
  const header = res.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds * 1000, RETRY_AFTER_CAP_MS);
};

/**
 * A 402 is only retryable when OpenRouter reports its in-flight budget
 * limit, which clears on its own. Other 402s are real billing failures.
 */
const isRetryableBudget = (body: unknown): boolean => {
  const error = asRecord(asRecord(body)?.error);
  const metadata = asRecord(error?.metadata);
  return metadata?.limit_source === "openrouter_in_flight_budget";
};

const shouldRetry = (res: Response, body: unknown): boolean =>
  res.status === 429 ||
  res.status >= 500 ||
  (res.status === 402 && isRetryableBudget(body));

/**
 * Judges one transcript segment. `questions` is a map of key → question
 * (see lib/questions.ts); `answers` echoes the same keys.
 */
export async function decide(
  fetchImpl: FetchLike,
  apiKey: string,
  state: DecisionState,
  questions: Record<string, DecisionQuestion>,
  options: { sleep?: Sleep } = {},
): Promise<DecideResult> {
  const sleep = options.sleep ?? defaultSleep;
  const keys = Object.keys(questions);
  let lastError: JevError | null = null;
  let retryAfter: number | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      // Exponential backoff, raised to the Retry-After hint when present.
      await sleep(Math.max(BACKOFF_MS[attempt - 1], retryAfter ?? 0));
      retryAfter = null;
    }
    let res: Response;
    try {
      res = await fetchImpl(DECISIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: MODEL, state, questions }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      lastError = new JevError(
        `Decisions request failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      continue;
    }
    const text = await res.text().catch(() => "");
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!res.ok) {
      const excerpt = text.slice(0, 200);
      if (shouldRetry(res, body)) {
        lastError = new JevError(
          `Decisions HTTP ${res.status}: ${excerpt}`,
          res.status,
        );
        retryAfter = retryAfterMs(res);
        continue;
      }
      throw new JevError(`Decisions HTTP ${res.status}: ${excerpt}`, res.status);
    }
    const answers = asRecord(asRecord(body)?.answers);
    if (!answers) {
      throw new JevError("Decisions response had no answers object");
    }
    const normalized: Record<string, number> = {};
    for (const key of keys) {
      const entry = asRecord(answers[key]);
      if (
        entry?.type === "noul" &&
        typeof entry.noul === "number" &&
        Number.isFinite(entry.noul)
      ) {
        normalized[key] = entry.noul;
      } else {
        throw new JevError(
          `Decisions answer for "${key}" was missing or not a noul`,
        );
      }
    }
    return { answers: normalized, usage: asRecord(body)?.usage };
  }
  throw lastError ?? new JevError("Decisions request failed");
}
