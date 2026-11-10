import { describe, expect, it, vi } from "vitest";
import {
  assertSafeUrl,
  fetchText,
  SafeFetchError,
  type FetchLike,
} from "./safeFetch";

const okFetch = (body: string | Uint8Array): FetchLike =>
  vi.fn(async () => new Response(body as BodyInit, { status: 200 }));

const code = (error: unknown): string =>
  error instanceof SafeFetchError ? error.code : `not SafeFetchError: ${error}`;

describe("assertSafeUrl", () => {
  it("accepts plain https URLs and explicit :443", () => {
    expect(assertSafeUrl("https://example.com/feed.xml").hostname).toBe(
      "example.com",
    );
    expect(assertSafeUrl("https://example.com:443/x").port).toBe("");
  });

  it("rejects non-https schemes and unparseable URLs", () => {
    expect(() => assertSafeUrl("http://example.com")).toThrowError(
      expect.objectContaining({ code: "not-https" }),
    );
    expect(() => assertSafeUrl("ftp://example.com")).toThrow();
    expect(() => assertSafeUrl("not a url")).toThrowError(
      expect.objectContaining({ code: "not-https" }),
    );
  });

  it("rejects IP literals, localhost and internal suffixes", () => {
    for (const url of [
      "https://127.0.0.1/feed",
      "https://0x7f000001/feed", // hex IPv4 normalizes to 127.0.0.1
      "https://[::1]/feed",
      "https://localhost/feed",
      "https://api.local/feed",
      "https://db.internal/feed",
      "https://router.lan/feed",
      "https://foo.localhost/feed",
    ]) {
      expect(() => assertSafeUrl(url), url).toThrowError(
        expect.objectContaining({ code: "private-host" }),
      );
    }
  });

  it("rejects userinfo tricks and non-default ports", () => {
    for (const url of [
      "https://user:pass@example.com/feed",
      "https://example.com@evil.test/feed",
      "https://example.com:8443/feed",
      "https://example.com:80/feed",
    ]) {
      expect(() => assertSafeUrl(url), url).toThrowError(
        expect.objectContaining({ code: "private-host" }),
      );
    }
  });
});

describe("fetchText", () => {
  it("returns body text for OK responses", async () => {
    const fetchImpl = okFetch("<rss>hi</rss>");
    await expect(
      fetchText("https://example.com/feed", { fetchImpl }),
    ).resolves.toBe("<rss>hi</rss>");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("throws http-error with status and excerpt for non-OK", async () => {
    const fetchImpl: FetchLike = async () =>
      new Response("upstream exploded", { status: 503 });
    const error = await fetchText("https://example.com", {
      fetchImpl,
    }).catch((e) => e);
    expect(error).toBeInstanceOf(SafeFetchError);
    expect(error.code).toBe("http-error");
    expect(error.status).toBe(503);
    expect(error.message).toContain("upstream exploded");
  });

  it("rejects when content-length exceeds maxBytes", async () => {
    const fetchImpl: FetchLike = async () =>
      new Response("0123456789", {
        status: 200,
        headers: { "content-length": "5000" },
      });
    const error = await fetchText("https://example.com", {
      fetchImpl,
      maxBytes: 100,
    }).catch((e) => e);
    expect(code(error)).toBe("too-large");
  });

  it("streams and measures bodies without content-length", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(64)));
        controller.enqueue(new TextEncoder().encode("y".repeat(64)));
        controller.close();
      },
    });
    const fetchImpl: FetchLike = async () =>
      new Response(stream as unknown as BodyInit, { status: 200 });
    const error = await fetchText("https://example.com", {
      fetchImpl,
      maxBytes: 100,
    }).catch((e) => e);
    expect(code(error)).toBe("too-large");

    const small = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("tiny"));
        controller.close();
      },
    });
    await expect(
      fetchText("https://example.com", {
        fetchImpl: async () =>
          new Response(small as unknown as BodyInit, { status: 200 }),
        maxBytes: 100,
      }),
    ).resolves.toBe("tiny");
  });

  it("follows revalidated https redirects up to 4 hops", async () => {
    const fetchImpl: FetchLike = vi.fn(async (url: string) => {
      if (url === "https://example.com/a") {
        return new Response(null, {
          status: 302,
          headers: { location: "/b" },
        });
      }
      if (url === "https://example.com/b") {
        return new Response("done", { status: 200 });
      }
      return new Response("nope", { status: 404 });
    });
    await expect(
      fetchText("https://example.com/a", { fetchImpl }),
    ).resolves.toBe("done");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects redirects to disallowed URLs", async () => {
    const fetchImpl: FetchLike = async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/meta" },
      });
    const error = await fetchText("https://example.com", {
      fetchImpl,
    }).catch((e) => e);
    expect(code(error)).toBe("bad-redirect");
  });

  it("rejects redirect chains longer than the hop cap", async () => {
    const fetchImpl: FetchLike = async (url: string) =>
      new Response(null, {
        status: 302,
        headers: { location: url + "x" },
      });
    const error = await fetchText("https://example.com/", {
      fetchImpl,
      maxHops: 2,
    }).catch((e) => e);
    expect(code(error)).toBe("bad-redirect");
  });

  it("maps abort timeouts to the timeout code", async () => {
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("timed out", "TimeoutError")),
        );
      });
    const error = await fetchText("https://example.com", {
      fetchImpl,
      timeoutMs: 5,
    }).catch((e) => e);
    expect(code(error)).toBe("timeout");
  });
});
