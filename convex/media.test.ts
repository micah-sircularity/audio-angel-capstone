// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { describe, it, expect, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import workflow from "@convex-dev/workflow/test";
import { api, internal } from "./_generated/api";
import { planWords } from "./lib/mediaPlan";
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const identity = { subject: "media-user", tokenIdentifier: "test|media-user" };

function testContext() {
  const t = convexTest(schema, modules);
  workflow.register(t);
  return t;
}

describe("cached media pipeline", () => {
  it("requires authentication for paid processing", async () => {
    const t = testContext();
    await expect(
      t.mutation(api.media.start, {
        source: { kind: "audius", trackId: "m7AlvqA" },
      }),
    ).rejects.toThrow(/Sign in/);
  });
  it("deduplicates preparation and protects asset reads across accounts", async () => {
    const t = testContext(),
      user = t.withIdentity(identity);
    const args = { source: { kind: "audius" as const, trackId: "m7AlvqA" } };
    const a = await user.mutation(api.media.start, args),
      b = await user.mutation(api.media.start, args);
    expect(a).toBe(b);
    expect(
      (await user.query(api.media.read, { assetId: a }))?.asset.stage,
    ).toBe("queued");
    expect(await t.query(api.media.read, { assetId: a })).toBeNull();
    expect(
      await t
        .withIdentity({ subject: "other", tokenIdentifier: "test|other" })
        .query(api.media.read, { assetId: a }),
    ).toBeNull();
  });
  it("ignores callbacks from a superseded attempt", async () => {
    const t = testContext(),
      user = t.withIdentity(identity);
    const id = await user.mutation(api.media.start, {
      source: { kind: "audius", trackId: "retry" },
    });
    await t.mutation(internal.media.progress, {
      assetId: id,
      attempt: 1,
      stage: "failed",
      error: "network",
    });
    await user.mutation(api.media.start, {
      source: { kind: "audius", trackId: "retry" },
    });
    expect(
      await t.mutation(internal.media.progress, {
        assetId: id,
        attempt: 1,
        stage: "review",
      }),
    ).toBe(false);
    expect(
      (await user.query(api.media.read, { assetId: id }))?.asset.attempt,
    ).toBe(2);
  });
  it("pins original audio, caches word-list renders and creates a new mix for changed settings", async () => {
    const t = testContext(),
      user = t.withIdentity(identity);
    const id = await user.mutation(api.media.start, {
      source: { kind: "audius", trackId: "cached" },
    });
    await t.mutation(internal.media.progress, {
      assetId: id,
      attempt: 1,
      stage: "review",
      durationMs: 10000,
      sourceHash: "original-content-hash",
      words: [
        { text: "Test!", startMs: 1000, endMs: 1500 },
        { text: "other", startMs: 3000, endMs: 3300 },
      ],
      gain: 1,
    });
    const a = await user.mutation(api.media.requestMix, {
      assetId: id,
      words: ["test"],
    });
    const b = await user.mutation(api.media.requestMix, {
      assetId: id,
      words: ["TEST", "test"],
    });
    expect(a).toBe(b);
    const c = await user.mutation(api.media.requestMix, {
      assetId: id,
      words: ["other"],
    });
    expect(c).not.toBe(a);
    const state = await user.query(api.media.read, { assetId: id, mixId: a });
    expect(state?.mix?.matches).toHaveLength(1);
    expect(state?.mix?.intervals[0]).toEqual({ start: 0.96, end: 1.57 });
    expect(
      await user.mutation(api.media.start, {
        source: { kind: "audius", trackId: "cached" },
      }),
    ).toBe(id);
  });
  it("uses the podcast branch and limits settings", async () => {
    const t = testContext(),
      user = t.withIdentity(identity);
    const id = await user.mutation(api.media.start, {
      source: {
        kind: "podcast",
        feedUrl: "https://example.com/feed.xml",
        guid: "episode-1",
      },
    });
    expect(
      (await user.query(api.media.read, { assetId: id }))?.asset.kind,
    ).toBe("podcast");
    await t.mutation(internal.media.progress, {
      assetId: id,
      attempt: 1,
      stage: "review",
      sourceHash: "podcast",
      durationMs: 10000,
      words: [{ text: "word", startMs: 1000, endMs: 1500 }],
    });
    await expect(
      user.mutation(api.media.requestMix, {
        assetId: id,
        words: Array(101).fill("word"),
      }),
    ).rejects.toThrow(/100/);
  });
  it("saves a first-30-minute preview instead of rejecting a long podcast", async () => {
    const t = testContext(),
      user = t.withIdentity(identity);
    const source = {
      kind: "podcast" as const,
      feedUrl: "https://example.com/feed.xml",
      guid: "long-episode",
    };
    const assetId = await t.run(
      async (ctx) =>
        await ctx.db.insert("mediaAssets", {
          owner: identity.tokenIdentifier,
          sourceKey: "pod:long-preview-test",
          kind: "podcast",
          version: 1,
          stage: "queued",
          attempt: 1,
          updatedAt: Date.now(),
          timings: {},
        }),
    );
    const fileId = await t.run(
      async (ctx) =>
        await ctx.storage.store(
          new Blob(["prepared-preview"], { type: "audio/mpeg" }),
        ),
    );
    vi.stubEnv("MEDIA_PREVIEW_URL", "https://worker.example/preview");
    vi.stubEnv("MEDIA_WORKER_TOKEN", "test-token");
    const fetcher = vi.fn(async (url: string) => {
      if (url.startsWith("https://worker.example/preview"))
        return new Response(
          JSON.stringify({
            fileId,
            sourceHash: "preview-hash",
            durationMs: 1800000,
            sourceDurationMs: 7200000,
            isPreview: true,
            download_s: 1,
            preview_encode_s: 2,
          }),
          { status: 200 },
        );
      if (url === "https://example.com/feed.xml")
        return new Response(
          '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>Test show</title><item><title>Two hour episode</title><guid>long-episode</guid><itunes:duration>7200</itunes:duration><enclosure url="https://example.com/large.mp3" type="audio/mpeg" length="150000000"/></item></channel></rss>',
        );
      throw Error("The large episode must not be downloaded through Convex");
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      await t.action(internal.media.prepare, {
        assetId,
        attempt: 1,
        source,
        phase: "save",
      });
      const result = await user.query(api.media.read, { assetId });
      expect(result?.asset.error).toBeUndefined();
      expect(result?.asset.originalId).toBe(fileId);
      expect(result?.asset.durationMs).toBe(1800000);
      expect(result?.asset.sourceDurationMs).toBe(7200000);
      expect(result?.asset.isPreview).toBe(true);
      expect(
        fetcher.mock.calls.some(([url]) =>
          url.startsWith("https://worker.example/preview"),
        ),
      ).toBe(true);
      expect(
        fetcher.mock.calls.some(
          ([url]) => url === "https://example.com/large.mp3",
        ),
      ).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });
  it("clamps transcription timestamps to a prepared preview instead of rejecting codec padding", async () => {
    const t = testContext(),
      user = t.withIdentity(identity);
    const assetId = await t.run(async (ctx) => {
      const originalId = await ctx.storage.store(
        new Blob(["preview"], { type: "audio/mpeg" }),
      );
      return await ctx.db.insert("mediaAssets", {
        owner: identity.tokenIdentifier,
        sourceKey: "pod:cutoff",
        kind: "podcast",
        version: 1,
        stage: "transcribing",
        attempt: 1,
        updatedAt: Date.now(),
        timings: {},
        originalId,
        isPreview: true,
        durationMs: 1800000,
        sourceDurationMs: 7200000,
      });
    });
    vi.stubEnv("DEEPGRAM_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              metadata: { duration: 1800.5 },
              results: {
                channels: [
                  {
                    alternatives: [
                      {
                        words: [
                          {
                            word: "ending",
                            start: 1799.8,
                            end: 1800.3,
                            confidence: 0.99,
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            }),
          ),
      ),
    );
    try {
      await t.action(internal.media.prepare, {
        assetId,
        attempt: 1,
        phase: "transcribe",
        source: {
          kind: "podcast",
          feedUrl: "https://example.com/feed.xml",
          guid: "episode",
        },
      });
      const result = await user.query(api.media.read, { assetId });
      expect(result?.asset.stage).toBe("review");
      expect(result?.asset.durationMs).toBe(1800000);
      expect(result?.asset.words?.[0].endMs).toBe(1800000);
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });
  it("merges padding around adjoining words without substring matching", () => {
    const result = planWords(
      [
        { text: "test", startMs: 100, endMs: 300 },
        { text: "test", startMs: 310, endMs: 500 },
        { text: "testing", startMs: 800, endMs: 1200 },
      ],
      ["test"],
      2000,
    );
    expect(result.matches).toHaveLength(2);
    expect(result.intervals).toEqual([{ start: 0.06, end: 0.57 }]);
  });
});
