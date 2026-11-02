import { describe, expect, it, vi } from "vitest";
import { TaddyError, TaddyProvider } from "./taddy";
import { handlePodcastTranscriptRoute } from "./podcast-route";

const REQUEST = {
  showName: "Value 4 Value",
  episodeName: "Episode One",
  durationMs: 3_600_000,
};

const SRT =
  "1\n00:00:01,000 --> 00:00:03,000\nHello there\n\n2\n00:00:03,000 --> 00:00:05,000\nWorld\n";

const searchBody = (episodes: unknown[]) =>
  JSON.stringify({
    data: { search: { searchId: "s1", podcastEpisodes: episodes } },
  });

const episode = (overrides: Record<string, unknown> = {}) => ({
  uuid: "ep-1",
  name: "Episode One",
  duration: 3590,
  podcastSeries: { uuid: "s-1", name: "Value 4 Value" },
  transcriptUrlsWithDetails: [
    {
      url: "https://files.example.com/ep1.srt",
      type: "application/x-subrip",
      language: "en",
      hasTimecodes: false,
      isTaddyExclusive: false,
    },
  ],
  ...overrides,
});

const okJson = (body: string) =>
  new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const makeProvider = (
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>,
  extra: Record<string, unknown> = {},
) =>
  new TaddyProvider({
    fetch: vi.fn(fetchImpl) as never,
    userId: "user-1",
    apiKey: "key-1",
    dnsLookup: async () => [{ address: "93.184.216.34" }],
    ...extra,
  });

describe("TaddyProvider", () => {
  it("throws not-configured without credentials", async () => {
    const provider = new TaddyProvider({
      fetch: vi.fn() as never,
      userId: "",
      apiKey: "",
    });
    await expect(provider.transcript(REQUEST)).rejects.toMatchObject({
      status: 503,
      message: "not-configured",
    });
  });

  it("searches with credentials and returns synced publisher transcript", async () => {
    const calls: { input: string; init?: RequestInit }[] = [];
    const provider = makeProvider(async (input, init) => {
      calls.push({ input, init: init as RequestInit });
      if (input === "https://api.taddy.org") return okJson(searchBody([episode()]));
      return new Response(SRT, { status: 200 });
    });
    const result = await provider.transcript(REQUEST);
    expect(result).toMatchObject({
      source: "taddy",
      status: "synced",
      episode: {
        taddyUuid: "ep-1",
        transcriptOrigin: "publisher",
        durationMs: 3_590_000,
      },
      durationDeltaMs: 10_000,
    });
    expect(result.status === "synced" && result.spans).toHaveLength(2);
    expect(result.status === "synced" && result.spans[0].text).toBe(
      "Hello there",
    );
    const taddy = calls[0];
    expect(JSON.parse(String(taddy.init?.body)).variables.term).toBe(
      "Value 4 Value Episode One",
    );
    expect(
      (taddy.init?.headers as Record<string, string>)["X-USER-ID"],
    ).toBe("user-1");
    // Publisher fetch must not carry Taddy credentials.
    expect(
      (calls[1].init?.headers as Record<string, string> | undefined)?.[
        "X-API-KEY"
      ],
    ).toBeUndefined();
  });

  it("returns not-found when names do not match", async () => {
    const provider = makeProvider(async () =>
      okJson(searchBody([episode({ name: "Different Episode" })])),
    );
    const result = await provider.transcript(REQUEST);
    expect(result).toMatchObject({ status: "not-found", episode: null });
  });

  it("caps the search term at 8 words for Taddy", async () => {
    let term = "";
    const provider = makeProvider(async (input, init) => {
      if (input === "https://api.taddy.org")
        term = JSON.parse(String(init?.body)).variables.term;
      return okJson(searchBody([]));
    });
    await provider.transcript({
      showName: "A Very Long Podcast Show Name With Many Words",
      episodeName:
        "An Equally Long Episode Title That Keeps Going And Going",
      durationMs: 60000,
    });
    expect(term.split(/\s+/).length).toBeLessThanOrEqual(8);
  });

  it("matches after normalization (punctuation, &, case)", async () => {
    const provider = makeProvider(async (input) => {
      if (input === "https://api.taddy.org")
        return okJson(
          searchBody([
            episode({
              name: "Episode One!",
              podcastSeries: { uuid: "s", name: "Value 4 Value & Friends" },
            }),
          ]),
        );
      return new Response(SRT);
    });
    const result = await provider.transcript({
      ...REQUEST,
      showName: "value 4 value and friends",
    });
    expect(result.status).toBe("synced");
  });

  it("tries the next candidate when one file is empty or unparseable", async () => {
    let publisherFetches = 0;
    const provider = makeProvider(async (input) => {
      if (input === "https://api.taddy.org")
        return okJson(
          searchBody([
            episode({
              transcriptUrlsWithDetails: [
                {
                  url: "https://a.example.com/empty.srt",
                  type: "application/x-subrip",
                  language: "en",
                  hasTimecodes: true,
                  isTaddyExclusive: false,
                },
                {
                  url: "https://a.example.com/good.srt",
                  type: "application/x-subrip",
                  language: "en",
                  hasTimecodes: false,
                  isTaddyExclusive: false,
                },
              ],
            }),
          ]),
        );
      publisherFetches++;
      return input.includes("empty")
        ? new Response("", { status: 200 })
        : new Response(SRT, { status: 200 });
    });
    const result = await provider.transcript(REQUEST);
    expect(result.status).toBe("synced");
    expect(publisherFetches).toBe(2);
  });

  it("returns requires-upgrade when only exclusive transcripts 401", async () => {
    const provider = makeProvider(async (input) => {
      if (input === "https://api.taddy.org")
        return okJson(
          searchBody([
            episode({
              transcriptUrlsWithDetails: [
                {
                  url: "https://ax2.taddy.org/x/transcript.vtt",
                  type: "text/vtt",
                  language: "en",
                  hasTimecodes: true,
                  isTaddyExclusive: true,
                },
              ],
            }),
          ]),
        );
      return new Response("You need to be a Pro or Business Taddy API user", {
        status: 401,
      });
    });
    const result = await provider.transcript(REQUEST);
    expect(result).toMatchObject({
      status: "requires-upgrade",
      episode: { transcriptOrigin: "taddy" },
      spans: [],
    });
  });

  it("returns no-transcript when nothing parses", async () => {
    const provider = makeProvider(async (input) => {
      if (input === "https://api.taddy.org")
        return okJson(searchBody([episode()]));
      return new Response("not subtitles at all", { status: 200 });
    });
    const result = await provider.transcript(REQUEST);
    expect(result).toMatchObject({ status: "no-transcript", spans: [] });
  });

  it("rejects SSRF targets: http, localhost, private DNS", async () => {
    const cases: [string, (() => Promise<{ address: string }[]>) | undefined][] =
      [
        ["http://files.example.com/x.srt", undefined],
        ["https://localhost/x.srt", undefined],
        ["https://127.0.0.1/x.srt", undefined],
        [
          "https://files.example.com/x.srt",
          async () => [{ address: "10.0.0.5" }],
        ],
      ];
    for (const [url, dnsLookup] of cases) {
      let transcriptFetch = 0;
      const provider = makeProvider(
        async (input) => {
          if (input === "https://api.taddy.org")
            return okJson(
              searchBody([
                episode({
                  transcriptUrlsWithDetails: [
                    {
                      url,
                      type: "application/x-subrip",
                      language: "en",
                      hasTimecodes: true,
                      isTaddyExclusive: false,
                    },
                  ],
                }),
              ]),
            );
          transcriptFetch++;
          return new Response(SRT);
        },
        dnsLookup ? { dnsLookup } : {},
      );
      const result = await provider.transcript(REQUEST);
      expect(result.status).toBe("no-transcript");
      expect(transcriptFetch).toBe(0);
    }
  });

  it.each([
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:c0a8:101",
    "64:ff9b::a9fe:a9fe",
    "64:ff9b::10.0.0.1",
    "198.18.0.1",
    "198.19.255.255",
  ])(
    "rejects embedded/private resolver address %s",
    async (address) => {
      const provider = makeProvider(
        async (input) => {
          if (input === "https://api.taddy.org")
            return okJson(searchBody([episode()]));
          return new Response(SRT);
        },
        { dnsLookup: async () => [{ address }] },
      );
      const result = await provider.transcript(REQUEST);
      expect(result.status).toBe("no-transcript");
    },
  );

  it("allows a public IPv6 resolver address", async () => {
    let fetched = 0;
    const provider = makeProvider(
      async (input) => {
        if (input === "https://api.taddy.org")
          return okJson(searchBody([episode()]));
        fetched++;
        return new Response(SRT);
      },
      { dnsLookup: async () => [{ address: "2001:4860:4860::8888" }] },
    );
    const result = await provider.transcript(REQUEST);
    expect(result.status).toBe("synced");
    expect(fetched).toBe(1);
  });

  it("re-validates redirects and rejects a private-network hop", async () => {
    const fetched: string[] = [];
    const provider = makeProvider(
      async (input) => {
        if (input === "https://api.taddy.org")
          return okJson(
            searchBody([
              episode({
                transcriptUrlsWithDetails: [
                  {
                    url: "https://cdn.example.com/redirect",
                    type: "application/x-subrip",
                    language: "en",
                    hasTimecodes: true,
                    isTaddyExclusive: false,
                  },
                ],
              }),
            ]),
          );
        fetched.push(input);
        if (input === "https://cdn.example.com/redirect")
          return new Response(null, {
            status: 302,
            headers: { Location: "https://169.254.169.254/latest" },
          });
        return new Response(SRT);
      },
      {
        dnsLookup: async (host: string) =>
          host === "169.254.169.254"
            ? [{ address: "169.254.169.254" }]
            : [{ address: "93.184.216.34" }],
      },
    );
    const result = await provider.transcript(REQUEST);
    expect(result.status).toBe("no-transcript");
    expect(fetched).toEqual(["https://cdn.example.com/redirect"]);
  });

  it("sets cooldown after a 429 and rethrows without upstream calls", async () => {
    let now = 1_000_000;
    const fetches: string[] = [];
    const provider = makeProvider(
      async (input) => {
        fetches.push(input);
        return new Response("slow down", {
          status: 429,
          headers: { "Retry-After": "30" },
        });
      },
      { now: () => now },
    );
    await expect(provider.transcript(REQUEST)).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 30,
    });
    now += 10_000;
    await expect(provider.transcript(REQUEST)).rejects.toMatchObject({
      status: 429,
    });
    now += 60_000;
    await expect(provider.transcript(REQUEST)).rejects.toMatchObject({
      status: 429,
    });
    expect(fetches).toHaveLength(2);
  });

  it("maps GraphQL rate-limit errors to cooldown", async () => {
    const provider = makeProvider(async () =>
      okJson(
        JSON.stringify({
          errors: [{ code: "API_RATE_LIMIT_EXCEEDED", message: "x" }],
        }),
      ),
    );
    await expect(provider.transcript(REQUEST)).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 60,
    });
  });

  it("maps API_KEY_INVALID to a safe 502", async () => {
    const provider = makeProvider(async () =>
      okJson(
        JSON.stringify({
          errors: [{ code: "API_KEY_INVALID", message: "secret detail" }],
        }),
      ),
    );
    await expect(provider.transcript(REQUEST)).rejects.toMatchObject({
      status: 502,
      message: "The transcript provider rejected our credentials.",
    });
  });

  it("caches results and deduplicates in-flight requests", async () => {
    let searchCalls = 0;
    const provider = makeProvider(async (input) => {
      if (input === "https://api.taddy.org") {
        searchCalls++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return okJson(searchBody([episode()]));
      }
      return new Response(SRT);
    });
    const [a, b] = await Promise.all([
      provider.transcript(REQUEST),
      provider.transcript(REQUEST),
    ]);
    expect(a).toEqual(b);
    const c = await provider.transcript(REQUEST);
    expect(c).toEqual(a);
    expect(searchCalls).toBe(1);
  });

  it("expires negative results sooner than positives", async () => {
    let now = 0;
    let searchCalls = 0;
    const provider = makeProvider(
      async (input) => {
        if (input === "https://api.taddy.org") {
          searchCalls++;
          return okJson(searchBody([]));
        }
        return new Response(SRT);
      },
      { now: () => now },
    );
    await provider.transcript(REQUEST);
    await provider.transcript(REQUEST);
    expect(searchCalls).toBe(1);
    now += 6 * 3_600_000 + 1;
    await provider.transcript(REQUEST);
    expect(searchCalls).toBe(2);
  });
});

describe("podcast transcript route", () => {
  const route = (query: string, provider: TaddyProvider, method = "GET") =>
    handlePodcastTranscriptRoute(
      new URL(`http://server/api/podcast-transcript${query}`),
      method,
      provider,
    );
  const okProvider = () =>
    new TaddyProvider({
      fetch: async () => okJson(searchBody([episode()])),
      userId: "u",
      apiKey: "k",
      dnsLookup: async () => [{ address: "93.184.216.34" }],
    });

  it("returns 200 for a valid synced lookup", async () => {
    const fetchImpl = vi.fn(async (input: string) =>
      input === "https://api.taddy.org"
        ? okJson(searchBody([episode()]))
        : new Response(SRT),
    );
    const provider = new TaddyProvider({
      fetch: fetchImpl,
      userId: "u",
      apiKey: "k",
      dnsLookup: async () => [{ address: "93.184.216.34" }],
    });
    const result = await route(
      "?show_name=Value%204%20Value&episode_name=Episode%20One&duration_ms=3600000",
      provider,
    );
    expect(result?.status).toBe(200);
    expect(result?.body).toMatchObject({ status: "synced" });
  });

  it("rejects invalid queries before calling the provider", async () => {
    const provider = okProvider();
    const spy = vi.spyOn(provider, "transcript");
    for (const query of [
      "?show_name=&episode_name=E&duration_ms=1000",
      "?show_name=S&episode_name=E&duration_ms=0",
      "?show_name=S&episode_name=E&duration_ms=abc",
      "?show_name=S&episode_name=E&duration_ms=21600001",
      `?show_name=${"x".repeat(201)}&episode_name=E&duration_ms=1000`,
    ]) {
      const result = await route(query, provider);
      expect(result?.status).toBe(400);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns 405 for non-GET", async () => {
    const result = await route(
      "?show_name=S&episode_name=E&duration_ms=1000",
      okProvider(),
      "POST",
    );
    expect(result?.status).toBe(405);
    expect(result?.headers?.Allow).toBe("GET");
  });

  it("maps not-configured to 503 with a safe message", async () => {
    const provider = new TaddyProvider({
      fetch: vi.fn() as never,
      userId: "",
      apiKey: "",
    });
    const result = await route(
      "?show_name=S&episode_name=E&duration_ms=1000",
      provider,
    );
    expect(result?.status).toBe(503);
    expect(result?.body).toMatchObject({
      error: { code: "NOT_CONFIGURED" },
    });
  });

  it("maps provider cooldown to 429 with Retry-After", async () => {
    const provider = new TaddyProvider({
      fetch: async () =>
        new Response("limited", {
          status: 429,
          headers: { "Retry-After": "30" },
        }),
      userId: "u",
      apiKey: "k",
    });
    const result = await route(
      "?show_name=S&episode_name=E&duration_ms=1000",
      provider,
    );
    expect(result?.status).toBe(429);
    expect(result?.headers?.["Retry-After"]).toBe("30");
  });
});
