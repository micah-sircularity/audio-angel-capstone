/**
 * Deepgram pre-recorded transcription client. Sends a URL for Deepgram to
 * fetch (`{ "url": audioUrl }`) so audio bytes never pass through Convex.
 * `fetch` is injected for testability.
 */

import type { FetchLike } from "./safeFetch";

const LISTEN_URL =
  "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&utterances=true";
const TIMEOUT_MS = 240_000;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1_000, 2_000, 4_000];
/** Fallback segmentation target when utterances are unavailable. */
const FALLBACK_SEGMENT_MS = 8_000;
/** Hard cap on segment length; longer segments are re-split on words. */
const MAX_SEGMENT_MS = 45_000;

export type TranscriptWord = {
  startMs: number;
  endMs: number;
  text: string;
};

export type TranscriptSegment = {
  startMs: number;
  endMs: number;
  text: string;
  words: TranscriptWord[];
};

export type TranscriptResult = {
  durationMs: number;
  segments: TranscriptSegment[];
};

export class DeepgramError extends Error {
  readonly code: "http" | "no-speech";
  readonly status?: number;
  constructor(code: "http" | "no-speech", message: string, status?: number) {
    super(message);
    this.name = "DeepgramError";
    this.code = code;
    this.status = status;
  }
}

type Sleep = (ms: number) => Promise<void>;
const defaultSleep: Sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const toMs = (seconds: unknown): number =>
  Math.round((typeof seconds === "number" ? seconds : 0) * 1000);

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;

type RawWord = { startMs: number; endMs: number; text: string };

const mapWord = (raw: unknown): RawWord | null => {
  const word = asRecord(raw);
  if (!word) return null;
  const text =
    (typeof word.punctuated_word === "string" && word.punctuated_word) ||
    (typeof word.word === "string" && word.word) ||
    null;
  if (!text) return null;
  return { startMs: toMs(word.start), endMs: toMs(word.end), text };
};

const channelWords = (body: Record<string, unknown>): RawWord[] => {
  const results = asRecord(body.results);
  const channel = asRecord(
    Array.isArray(results?.channels) ? results.channels[0] : null,
  );
  const alternative = asRecord(
    Array.isArray(channel?.alternatives) ? channel.alternatives[0] : null,
  );
  const words = Array.isArray(alternative?.words) ? alternative.words : [];
  return words.map(mapWord).filter((word): word is RawWord => word !== null);
};

const endsWithPunctuation = (word: RawWord): boolean =>
  /[.!?]["'')\]]*$/.test(word.text);

/** Groups flat word timing into ~8s segments that break at punctuation. */
function groupWordsIntoSegments(words: RawWord[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let current: RawWord[] = [];
  const flush = () => {
    if (!current.length) return;
    segments.push({
      startMs: current[0].startMs,
      endMs: current[current.length - 1].endMs,
      text: current.map((word) => word.text).join(" "),
      words: current,
    });
    current = [];
  };
  for (const word of words) {
    current.push(word);
    const spanMs = word.endMs - current[0].startMs;
    if (endsWithPunctuation(word) || spanMs >= FALLBACK_SEGMENT_MS) flush();
  }
  flush();
  return segments;
}

/** Splits a >45s segment into word-grouped pieces, preferring punctuation. */
function splitLongSegment(segment: TranscriptSegment): TranscriptSegment[] {
  if (segment.endMs - segment.startMs <= MAX_SEGMENT_MS) return [segment];
  const pieces: TranscriptSegment[] = [];
  let current: TranscriptWord[] = [];
  const flush = () => {
    if (!current.length) return;
    pieces.push({
      startMs: current[0].startMs,
      endMs: current[current.length - 1].endMs,
      text: current.map((word) => word.text).join(" "),
      words: current,
    });
    current = [];
  };
  for (const word of segment.words) {
    const wouldExceed =
      current.length > 0 && word.endMs - current[0].startMs > MAX_SEGMENT_MS;
    if (wouldExceed) {
      // Back off to the last punctuation word if one sits inside the piece.
      let cut = current.length;
      for (let i = current.length - 1; i >= 0; i--) {
        if (endsWithPunctuation(current[i])) {
          cut = i + 1;
          break;
        }
      }
      const head = current.slice(0, cut);
      const tail = current.slice(cut);
      pieces.push({
        startMs: head[0].startMs,
        endMs: head[head.length - 1].endMs,
        text: head.map((w) => w.text).join(" "),
        words: head,
      });
      current = [...tail, word];
    } else {
      current.push(word);
    }
  }
  flush();
  return pieces;
}

const utteranceSegments = (body: Record<string, unknown>): TranscriptSegment[] => {
  const results = asRecord(body.results);
  const utterances = Array.isArray(results?.utterances) ? results.utterances : [];
  const segments: TranscriptSegment[] = [];
  for (const raw of utterances) {
    const utterance = asRecord(raw);
    if (!utterance) continue;
    const words = (Array.isArray(utterance.words) ? utterance.words : [])
      .map(mapWord)
      .filter((word): word is RawWord => word !== null);
    const text =
      typeof utterance.transcript === "string" && utterance.transcript.trim()
        ? utterance.transcript.trim()
        : words.map((word) => word.text).join(" ");
    if (!text) continue;
    segments.push({
      startMs: toMs(utterance.start),
      endMs: toMs(utterance.end),
      text,
      words,
    });
  }
  return segments;
};

const metadataDurationMs = (body: Record<string, unknown>): number => {
  const metadata = asRecord(body.metadata);
  return toMs(metadata?.duration);
};

/**
 * Transcribes a remote audio URL with nova-3 + utterances + smart_format.
 * Retries 429/5xx with exponential backoff; other 4xx fail immediately.
 */
export async function transcribeUrl(
  fetchImpl: FetchLike,
  apiKey: string,
  audioUrl: string,
  options: { sleep?: Sleep } = {},
): Promise<TranscriptResult> {
  const sleep = options.sleep ?? defaultSleep;
  let lastError: DeepgramError | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(BACKOFF_MS[attempt - 1]);
    let res: Response;
    try {
      res = await fetchImpl(LISTEN_URL, {
        method: "POST",
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: audioUrl }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      // Network/timeout failures are retried like 5xx.
      lastError = new DeepgramError(
        "http",
        `Deepgram request failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      continue;
    }
    if (res.ok) {
      const body = asRecord(await res.json());
      if (!body) {
        throw new DeepgramError("http", "Deepgram returned an invalid body");
      }
      const words = channelWords(body);
      if (words.length === 0) {
        throw new DeepgramError(
          "no-speech",
          "no-speech: Deepgram returned no words for this audio",
        );
      }
      const utterances = utteranceSegments(body);
      const raw =
        utterances.length > 0 ? utterances : groupWordsIntoSegments(words);
      const segments = raw.flatMap(splitLongSegment);
      const lastEnd = Math.max(...segments.map((s) => s.endMs));
      return {
        durationMs: Math.max(metadataDurationMs(body), lastEnd),
        segments,
      };
    }
    const excerpt = (await res.text().catch(() => "")).slice(0, 200);
    if (res.status === 429 || res.status >= 500) {
      lastError = new DeepgramError(
        "http",
        `Deepgram HTTP ${res.status}: ${excerpt}`,
        res.status,
      );
      continue;
    }
    throw new DeepgramError(
      "http",
      `Deepgram HTTP ${res.status}: ${excerpt}`,
      res.status,
    );
  }
  throw (
    lastError ?? new DeepgramError("http", "Deepgram request failed")
  );
}
