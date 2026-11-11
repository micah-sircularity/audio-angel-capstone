/**
 * SSRF-light fetch for user-supplied external URLs (podcast feeds, enclosures).
 * HTTPS only, no IP literals / localhost / internal suffixes / userinfo /
 * non-default ports. Redirects are followed manually and every hop is
 * revalidated. Bodies are size-capped.
 */

export type SafeFetchErrorCode =
  | "not-https"
  | "private-host"
  | "too-large"
  | "http-error"
  | "timeout"
  | "bad-redirect";

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;
  readonly status?: number;
  constructor(code: SafeFetchErrorCode, message: string, status?: number) {
    super(message);
    this.name = "SafeFetchError";
    this.code = code;
    this.status = status;
  }
}

export type FetchLike = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;
// Hostname suffixes that resolve to loopback, link-local or LAN names.
const PRIVATE_SUFFIXES = [".localhost", ".local", ".internal", ".lan"];

/**
 * Validates a URL against the SSRF-light rules and returns it parsed.
 * Throws SafeFetchError on any violation.
 */
export function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError("not-https", `Invalid URL: ${raw.slice(0, 120)}`);
  }
  if (url.protocol !== "https:") {
    throw new SafeFetchError(
      "not-https",
      `Only https: URLs are allowed (got ${url.protocol})`,
    );
  }
  const hostname = url.hostname.toLowerCase();
  if (!hostname) {
    throw new SafeFetchError("private-host", "URL has no host");
  }
  // WHATWG URL already normalizes hex/octal/integer IPv4 forms to dotted
  // decimal, so one regex covers obfuscated literals. IPv6 keeps brackets
  // or contains ':'.
  if (
    IPV4_LITERAL.test(hostname) ||
    hostname.includes(":") ||
    hostname === "localhost" ||
    PRIVATE_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new SafeFetchError(
      "private-host",
      `Host ${hostname} is not allowed`,
    );
  }
  // userinfo tricks like https://example.com@evil.test or https://user@host.
  if (url.username !== "" || url.password !== "") {
    throw new SafeFetchError(
      "private-host",
      "URLs with credentials are not allowed",
    );
  }
  // url.port is normalized away for https :443, so anything left is custom.
  if (url.port !== "" && url.port !== "443") {
    throw new SafeFetchError(
      "private-host",
      `Port ${url.port} is not allowed`,
    );
  }
  return url;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type SafeFetchOptions = {
  /** Overall per-request timeout applied to every hop. Default 15s. */
  timeoutMs?: number;
  /** Maximum redirect hops followed. Default 4. */
  maxHops?: number;
  /** Injected fetch implementation; defaults to global fetch. */
  fetchImpl?: FetchLike;
};

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

/**
 * fetch() with SSRF-light validation and manual, revalidated redirects.
 * Returns the final Response (any status; callers check res.ok).
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<Response> {
  const { timeoutMs = 15_000, maxHops = 4, fetchImpl = fetch } = options;
  let current = assertSafeUrl(rawUrl);
  for (let hop = 0; ; hop++) {
    let res: Response;
    try {
      res = await fetchImpl(current.toString(), {
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new SafeFetchError(
          "timeout",
          `Request to ${current.hostname} timed out after ${timeoutMs}ms`,
        );
      }
      throw new SafeFetchError(
        "http-error",
        `Request to ${current.hostname} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (!REDIRECT_STATUSES.has(res.status)) return res;
    if (hop >= maxHops) {
      throw new SafeFetchError(
        "bad-redirect",
        `Too many redirects fetching ${rawUrl.slice(0, 120)}`,
      );
    }
    const location = res.headers.get("location");
    if (!location) {
      throw new SafeFetchError(
        "bad-redirect",
        `Redirect from ${current.hostname} had no Location header`,
      );
    }
    // Resolve relative redirects against the current URL, then revalidate.
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      throw new SafeFetchError(
        "bad-redirect",
        `Redirect from ${current.hostname} had an invalid Location`,
      );
    }
    try {
      current = assertSafeUrl(next.toString());
    } catch (error) {
      const reason =
        error instanceof SafeFetchError ? error.message : String(error);
      throw new SafeFetchError(
        "bad-redirect",
        `Redirect from ${current.hostname} was rejected: ${reason}`,
      );
    }
  }
}

export type FetchBodyOptions = SafeFetchOptions & {
  /** Hard cap on the decoded body size in bytes. Default 1 MB. */
  maxBytes?: number;
};

async function readBodyCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) {
    // Mocked or bodyless responses: fall back to text() then measure.
    const text = await res.text();
    if (new TextEncoder().encode(text).length > maxBytes) {
      throw new SafeFetchError(
        "too-large",
        `Response body exceeded ${maxBytes} bytes`,
      );
    }
    return text;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new SafeFetchError(
          "too-large",
          `Response body exceeded ${maxBytes} bytes`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/** Fetch a URL and return the body as text, enforcing a size cap. */
export async function fetchText(
  url: string,
  options: FetchBodyOptions = {},
): Promise<string> {
  const { maxBytes = 1_048_576, ...rest } = options;
  const res = await safeFetch(url, rest);
  if (!res.ok) {
    const excerpt = await readBodyCapped(res, 512)
      .then((text) => text.slice(0, 200))
      .catch(() => "");
    throw new SafeFetchError(
      "http-error",
      `HTTP ${res.status} from ${url.slice(0, 120)}: ${excerpt}`,
      res.status,
    );
  }
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new SafeFetchError(
      "too-large",
      `Response is ${declared} bytes, over the ${maxBytes} byte cap`,
    );
  }
  return await readBodyCapped(res, maxBytes);
}

/** Fetch a URL and parse the body as JSON, enforcing a size cap. */
export async function fetchJson(
  url: string,
  options: FetchBodyOptions = {},
): Promise<unknown> {
  const text = await fetchText(url, options);
  try {
    return JSON.parse(text);
  } catch {
    throw new SafeFetchError(
      "http-error",
      `Invalid JSON from ${url.slice(0, 120)}`,
    );
  }
}
