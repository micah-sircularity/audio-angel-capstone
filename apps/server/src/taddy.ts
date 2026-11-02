import type {
  PodcastTranscriptRequest,
  PodcastTranscriptResponse,
} from "@audio-angel/contracts";
import {
  parsePodcastJson,
  parseSrt,
  parseVtt,
} from "@audio-angel/filters";
import type { LyricSpan } from "@audio-angel/contracts";
import net from "node:net";
import dns from "node:dns/promises";

export type TaddyFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type DnsLookup = (hostname: string) => Promise<{ address: string }[]>;

export class TaddyError extends Error {
  constructor(
    message: string,
    readonly status: 429 | 502 | 503 | 504,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

const TADDY_URL = "https://api.taddy.org";
const SEARCH_QUERY = `query EpisodeSearch($term: String!) {
  search(term: $term, filterForTypes: PODCASTEPISODE, limitPerPage: 10) {
    searchId
    podcastEpisodes {
      uuid
      name
      duration
      podcastSeries { uuid name }
      transcriptUrlsWithDetails { url type language hasTimecodes isTaddyExclusive }
    }
  }
}`;

const MAX_BODY = 5 * 1_048_576;
const POSITIVE_TTL_MS = 24 * 3_600_000;
const NEGATIVE_TTL_MS = 6 * 3_600_000;
const MAX_CACHE = 200;

// Stricter than the LRCLIB normalizer: punctuation/diacritics are stripped
// and & becomes "and" so publisher and Spotify titles line up.
const normalizeMatch = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("en")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

// Taddy rejects search terms longer than 8 space-separated words; favor the
// show's leading words plus as many episode words as fit.
const searchTerm = (showName: string, episodeName: string) => {
  const show = showName.trim().split(/\s+/);
  const episode = episodeName.trim().split(/\s+/);
  const showKeep = Math.min(show.length, Math.max(1, 8 - Math.min(episode.length, 6)));
  const episodeKeep = Math.min(episode.length, 8 - showKeep);
  return [...show.slice(0, showKeep), ...episode.slice(0, episodeKeep)]
    .join(" ")
    .replace(/[\s\-—|&,:;]+$/, "");
};

const parseRetryAfter = (value: string | null, now: number): number => {
  if (!value) return 60;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  if (Number.isFinite(date))
    return Math.max(1, Math.ceil((date - now) / 1000));
  return 60;
};

// Decodes the last 32 bits of an IPv6 address into dotted IPv4 when the
// address embeds one (v4-mapped ::ffff:a.b.c.d, hex form, or NAT64 64:ff9b::).
const embeddedIpv4 = (normalized: string): string | null => {
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (dotted) return dotted[1];
  const expand = (addr: string) => {
    const [head, tail] = addr.split("::");
    const headParts = head ? head.split(":") : [];
    const tailParts = tail ? tail.split(":") : [];
    const missing = 8 - headParts.length - tailParts.length;
    if (missing < 0) return null;
    return [...headParts, ...Array(missing).fill("0"), ...tailParts].map(
      (part) => parseInt(part, 16),
    );
  };
  if (!normalized.includes("::")) return null;
  const groups = expand(normalized);
  if (!groups || groups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff))
    return null;
  const last32 = groups.slice(6);
  const value = last32[0] * 0x10000 + last32[1];
  const asDotted = [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join(".");
  if (normalized.startsWith("::ffff:")) return asDotted;
  // NAT64 well-known prefix 64:ff9b::/96 embeds the v4 in the last 32 bits.
  if (groups[0] === 0x64 && groups[1] === 0xff9b) return asDotted;
  return null;
};

const isPrivateAddress = (address: string): boolean => {
  const family = net.isIP(address);
  if (family === 6) {
    const normalized = address.toLowerCase();
    // Loopback, link-local, unique-local, and embedded-IPv4 forms.
    if (normalized === "::1" || normalized === "::") return true;
    if (normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd"))
      return true;
    const embedded = embeddedIpv4(normalized);
    if (embedded) return isPrivateAddress(embedded);
    return false;
  }
  if (family !== 4) return true;
  const [a, b] = address.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
};

type TranscriptCandidate = {
  url: string;
  type: string;
  isTaddyExclusive: boolean;
};

type ParsedEpisode = {
  uuid: string;
  name: string;
  duration: number;
  showName: string;
  transcripts: TranscriptCandidate[];
};

export class TaddyProvider {
  private cooldownUntil = 0;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly lookup: DnsLookup;
  private readonly cache = new Map<
    string,
    { expiresAt: number; value: PodcastTranscriptResponse }
  >();
  private readonly inFlight = new Map<
    string,
    Promise<PodcastTranscriptResponse>
  >();
  constructor(
    private readonly deps: {
      fetch: TaddyFetch;
      now?: () => number;
      timeoutMs?: number;
      userId: string;
      apiKey: string;
      dnsLookup?: DnsLookup;
    },
  ) {
    this.now = deps.now ?? Date.now;
    this.timeoutMs = deps.timeoutMs ?? 15_000;
    this.lookup = deps.dnsLookup ?? ((host) => dns.lookup(host, { all: true }));
  }

  async transcript(
    request: PodcastTranscriptRequest,
  ): Promise<PodcastTranscriptResponse> {
    if (!this.deps.userId || !this.deps.apiKey)
      throw new TaddyError("not-configured", 503);
    const key = [
      normalizeMatch(request.showName),
      normalizeMatch(request.episodeName),
      Math.round(request.durationMs / 1000),
    ].join("|");
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.value;
    if (cached) this.cache.delete(key);
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const run = this.lookupUncached(request);
    this.inFlight.set(key, run);
    try {
      const result = await run;
      const positive = result.status === "synced";
      if (this.cache.size >= MAX_CACHE) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
      this.cache.set(key, {
        expiresAt: this.now() + (positive ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
        value: result,
      });
      return result;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async lookupUncached(
    request: PodcastTranscriptRequest,
  ): Promise<PodcastTranscriptResponse> {
    const episodes = await this.searchEpisodes(
      searchTerm(request.showName, request.episodeName),
    );
    const wantShow = normalizeMatch(request.showName);
    const wantEpisode = normalizeMatch(request.episodeName);
    const matches = episodes.filter(
      (episode) =>
        normalizeMatch(episode.showName) === wantShow &&
        normalizeMatch(episode.name) === wantEpisode,
    );
    if (!matches.length)
      return {
        source: "taddy",
        status: "not-found",
        episode: null,
        durationDeltaMs: null,
        spans: [],
      };
    const best = matches.reduce((a, b) =>
      Math.abs(a.duration * 1000 - request.durationMs) <=
      Math.abs(b.duration * 1000 - request.durationMs)
        ? a
        : b,
    );
    const episodeInfo = {
      taddyUuid: best.uuid,
      name: best.name,
      showName: best.showName,
      durationMs: Math.round(best.duration * 1000),
    };
    const durationDeltaMs = request.durationMs - episodeInfo.durationMs;
    const publishers = best.transcripts.filter(
      (candidate) =>
        !candidate.isTaddyExclusive && candidate.type !== "text/html",
    );
    const taddyOwned = best.transcripts.filter(
      (candidate) =>
        candidate.isTaddyExclusive && candidate.type !== "text/html",
    );
    const order = (list: TranscriptCandidate[]) => {
      const rank = (type: string) =>
        type === "text/vtt" ? 0 : type === "application/x-subrip" ? 1 : type === "application/json" ? 2 : 3;
      return [...list].sort((a, b) => rank(a.type) - rank(b.type));
    };
    for (const candidate of [...order(publishers), ...order(taddyOwned)]) {
      const outcome = await this.fetchTranscript(candidate);
      if (outcome.kind === "upgrade") {
        return {
          source: "taddy",
          status: "requires-upgrade",
          episode: { ...episodeInfo, transcriptOrigin: "taddy" },
          durationDeltaMs,
          spans: [],
        };
      }
      if (outcome.kind !== "ok") continue;
      const spans = parseTranscript(candidate.type, outcome.text);
      if (!spans.length || !spans.some((span) => span.text.trim())) continue;
      const lineSpans = spans.map((span) => ({
        startMs: span.startMs,
        endMs: span.endMs,
        text: span.text,
        timing: "line" as const,
      }));
      return {
        source: "taddy",
        status: "synced",
        episode: {
          ...episodeInfo,
          transcriptOrigin: candidate.isTaddyExclusive ? "taddy" : "publisher",
        },
        durationDeltaMs,
        spans: lineSpans as [typeof lineSpans[number], ...typeof lineSpans],
      };
    }
    return {
      source: "taddy",
      status: "no-transcript",
      episode: { ...episodeInfo, transcriptOrigin: null },
      durationDeltaMs,
      spans: [],
    };
  }

  private async searchEpisodes(term: string): Promise<ParsedEpisode[]> {
    const now = this.now();
    if (now < this.cooldownUntil)
      throw new TaddyError(
        "The transcript provider asked us to slow down.",
        429,
        Math.ceil((this.cooldownUntil - now) / 1000),
      );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let text: string;
    try {
      const response = await this.deps.fetch(TADDY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-USER-ID": this.deps.userId,
          "X-API-KEY": this.deps.apiKey,
        },
        body: JSON.stringify({
          query: SEARCH_QUERY,
          variables: { term },
        }),
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403)
        throw new TaddyError(
          "The transcript provider rejected our credentials.",
          502,
        );
      if (response.status === 429 || response.status === 503) {
        const retryAfter = parseRetryAfter(
          response.headers.get("retry-after"),
          this.now(),
        );
        this.cooldownUntil = this.now() + retryAfter * 1000;
        throw new TaddyError(
          "The transcript provider asked us to slow down. Retry shortly.",
          response.status,
          retryAfter,
        );
      }
      if (!response.ok)
        throw new TaddyError("The transcript provider returned an error.", 502);
      try {
        text = await this.readBody(response, controller.signal);
      } catch (error) {
        if (error instanceof TaddyError) throw error;
        if (controller.signal.aborted)
          throw new TaddyError("The transcript lookup timed out.", 504);
        throw new TaddyError(
          "The transcript provider failed mid-response.",
          502,
        );
      }
    } catch (error) {
      if (error instanceof TaddyError) throw error;
      if (controller.signal.aborted)
        throw new TaddyError("The transcript lookup timed out.", 504);
      throw new TaddyError("Could not reach the transcript provider.", 502);
    } finally {
      clearTimeout(timer);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new TaddyError(
        "The transcript provider returned malformed data.",
        502,
      );
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new TaddyError(
        "The transcript provider returned malformed data.",
        502,
      );
    const body = raw as {
      errors?: { code?: string }[];
      data?: { search?: { podcastEpisodes?: unknown } };
    };
    if (Array.isArray(body.errors) && body.errors.length) {
      const code = body.errors[0]?.code ?? "";
      if (code === "API_RATE_LIMIT_EXCEEDED") {
        this.cooldownUntil = this.now() + 60_000;
        throw new TaddyError(
          "The transcript provider asked us to slow down. Retry shortly.",
          429,
          60,
        );
      }
      if (code === "API_KEY_INVALID")
        throw new TaddyError(
          "The transcript provider rejected our credentials.",
          502,
        );
      throw new TaddyError("The transcript provider returned an error.", 502);
    }
    const list = body.data?.search?.podcastEpisodes;
    if (!Array.isArray(list))
      throw new TaddyError(
        "The transcript provider returned malformed data.",
        502,
      );
    const episodes: ParsedEpisode[] = [];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const series = record.podcastSeries as Record<string, unknown> | null;
      const transcripts = Array.isArray(record.transcriptUrlsWithDetails)
        ? record.transcriptUrlsWithDetails
        : [];
      if (
        typeof record.uuid !== "string" ||
        typeof record.name !== "string" ||
        typeof record.duration !== "number" ||
        !Number.isFinite(record.duration) ||
        !series ||
        typeof series.name !== "string"
      )
        continue;
      episodes.push({
        uuid: record.uuid,
        name: record.name,
        duration: record.duration,
        showName: series.name,
        transcripts: transcripts
          .filter(
            (entry): entry is Record<string, unknown> =>
              Boolean(entry) && typeof entry === "object",
          )
          .filter(
            (entry) =>
              typeof entry.url === "string" &&
              typeof entry.type === "string",
          )
          .map((entry) => ({
            url: entry.url as string,
            type: entry.type as string,
            isTaddyExclusive: entry.isTaddyExclusive === true,
          })),
      });
    }
    return episodes;
  }

  private async readBody(
    response: Response,
    signal: AbortSignal,
  ): Promise<string> {
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_BODY)
      throw new TaddyError("The transcript response was too large.", 502);
    const text = await Promise.race([
      response.text(),
      new Promise<never>((_, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        );
      }),
    ]);
    if (text.length > MAX_BODY)
      throw new TaddyError("The transcript response was too large.", 502);
    return text;
  }

  /**
   * Fetches a transcript URL. Taddy credentials are sent only to *.taddy.org
   * hosts; every hop of a publisher redirect is re-validated for SSRF.
   */
  private async fetchTranscript(
    candidate: TranscriptCandidate,
  ): Promise<
    | { kind: "ok"; text: string }
    | { kind: "upgrade" }
    | { kind: "unusable" }
  > {
    let url: string | null = candidate.url;
    for (let hop = 0; hop <= 3 && url; hop++) {
      let target: URL;
      try {
        target = new URL(url);
      } catch {
        return { kind: "unusable" };
      }
      if (!(await this.safeUrlCheck(target, candidate.isTaddyExclusive)))
        return { kind: "unusable" };
      const isTaddyHost = target.hostname === "taddy.org" ||
        target.hostname.endsWith(".taddy.org");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.deps.fetch(target.toString(), {
          headers: isTaddyHost
            ? {
                "X-USER-ID": this.deps.userId,
                "X-API-KEY": this.deps.apiKey,
              }
            : {},
          redirect: "manual",
          cache: "no-store",
          credentials: "omit",
          signal: controller.signal,
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          url = location ? new URL(location, target).toString() : null;
          continue;
        }
        if (
          isTaddyHost &&
          (response.status === 401 || response.status === 403)
        )
          return { kind: "upgrade" };
        if (!response.ok) return { kind: "unusable" };
        let text: string;
        try {
          text = await this.readBody(response, controller.signal);
        } catch {
          return { kind: "unusable" };
        }
        return text.trim() ? { kind: "ok", text } : { kind: "unusable" };
      } catch {
        return { kind: "unusable" };
      } finally {
        clearTimeout(timer);
      }
    }
    return { kind: "unusable" };
  }

  /** https only, no literal/local hosts, and DNS must resolve publicly. */
  private async safeUrlCheck(url: URL, isTaddyExclusive: boolean) {
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (
      !host ||
      net.isIP(host) ||
      host === "localhost" ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host.endsWith(".ts.net") ||
      host.endsWith(".localhost")
    )
      return false;
    if (isTaddyExclusive && !(host === "taddy.org" || host.endsWith(".taddy.org")))
      return false;
    try {
      const answers = await this.lookup(host);
      if (!answers.length) return false;
      return answers.every((answer) => !isPrivateAddress(answer.address));
    } catch {
      return false;
    }
  }
}

const parseTranscript = (type: string, text: string): LyricSpan[] => {
  if (type === "text/vtt" || /^\uFEFF?WEBVTT/m.test(text.slice(0, 64)))
    return parseVtt(text);
  if (type === "application/json") return parsePodcastJson(text);
  if (type === "application/x-subrip") return parseSrt(text);
  // Unknown type: guess by sniffing, since hasTimecodes/type are unreliable.
  return parseVtt(text).length
    ? parseVtt(text)
    : parseSrt(text).length
      ? parseSrt(text)
      : parsePodcastJson(text);
};
