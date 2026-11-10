// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { PIPELINE_VERSION } from "./lib/pipeline";

// Test files are excluded so their vitest imports never reach the VM.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const IDENTITY = { subject: "test-user", tokenIdentifier: "test|token" };

describe("requestProcessing", () => {
  it("rejects anonymous callers", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.listen.requestProcessing, {
        source: { kind: "audius", trackId: "abc" },
        questionKeys: ["profanity"],
      }),
    ).rejects.toThrow(/sign in/i);
  });

  it("queues a job under the canonical aud: sourceKey and dedupes", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(IDENTITY);
    const first = await asUser.mutation(api.listen.requestProcessing, {
      source: { kind: "audius", trackId: "track1" },
      questionKeys: ["profanity"],
    });
    expect(first).toEqual({ sourceKey: "aud:track1", status: "queued" });
    // A second request while queued returns the in-flight status.
    const second = await asUser.mutation(api.listen.requestProcessing, {
      source: { kind: "audius", trackId: "track1" },
      questionKeys: ["slurs"],
    });
    expect(second).toEqual({ sourceKey: "aud:track1", status: "queued" });
    const status = await t.query(api.listen.status, {
      sourceKey: "aud:track1",
    });
    expect(status.job?.status).toBe("queued");
    expect(status.job?.pipelineVersion).toBe(PIPELINE_VERSION);
  });

  it("canonicalizes podcast sourceKeys via sha256", async () => {
    const t = convexTest(schema, modules);
    const { podcastSourceKey } = await import("./lib/rss");
    const feedUrl = "https://feeds.example.com/show.xml";
    const guid = "episode-9";
    const expected = await podcastSourceKey(feedUrl, guid);
    const asUser = t.withIdentity(IDENTITY);
    const result = await asUser.mutation(api.listen.requestProcessing, {
      source: { kind: "podcast", feedUrl, guid },
      questionKeys: [],
    });
    expect(result.sourceKey).toBe(expected);
    expect(result.sourceKey).toMatch(/^pod:[0-9a-f]{32}$/);
  });

  it("sanitizes question keys without rejecting the request", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(IDENTITY);
    const result = await asUser.mutation(api.listen.requestProcessing, {
      source: { kind: "audius", trackId: "sanitize" },
      questionKeys: ["bogus-key", "topic:  spaced   out  ", "profanity"],
    });
    expect(result).toEqual({ sourceKey: "aud:sanitize", status: "queued" });
  });
});

describe("stored transcript + decisions", () => {
  it("serves chunks, decisions and source through public queries", async () => {
    const t = convexTest(schema, modules);
    const sourceKey = "aud:seeded";
    await t.mutation(internal.listen.upsertSource, {
      sourceKey,
      kind: "audius",
      audiusTrackId: "seeded",
      title: "Seed Song",
      artist: "Seed Artist",
      durationMs: 60_000,
    });
    await t.mutation(internal.listen.setJobStatus, {
      sourceKey,
      status: "ready",
    });
    await t.mutation(internal.listen.insertChunk, {
      sourceKey,
      chunkIndex: 0,
      segments: [
        {
          startMs: 0,
          endMs: 1_000,
          text: "hello world",
          words: [
            { startMs: 0, endMs: 500, text: "hello" },
            { startMs: 500, endMs: 1_000, text: "world" },
          ],
        },
      ],
    });
    // Idempotent insert: same chunkIndex again is a no-op.
    await t.mutation(internal.listen.insertChunk, {
      sourceKey,
      chunkIndex: 0,
      segments: [],
    });
    await t.mutation(internal.listen.storeDecisions, {
      sourceKey,
      questionKey: "profanity",
      chunkIndex: 0,
      probs: [0.91],
    });
    const status = await t.query(api.listen.status, { sourceKey });
    expect(status.source?.title).toBe("Seed Song");
    expect(status.job?.status).toBe("ready");
    const transcript = await t.query(api.listen.transcript, { sourceKey });
    expect(transcript.pipelineVersion).toBe(PIPELINE_VERSION);
    expect(transcript.chunks).toHaveLength(1);
    expect(transcript.chunks[0].segments[0].text).toBe("hello world");
    const decisions = await t.query(api.listen.decisions, {
      sourceKey,
      questionKeys: ["profanity", "slurs"],
    });
    expect(decisions.byQuestion.profanity).toEqual([
      { chunkIndex: 0, probs: [0.91] },
    ]);
    expect(decisions.byQuestion.slurs).toEqual([]);
  });

  it("a ready job with a missing question key requeues for classify", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(IDENTITY);
    const sourceKey = "aud:requeue";
    await t.mutation(internal.listen.upsertSource, {
      sourceKey,
      kind: "audius",
      title: "T",
      artist: "A",
      durationMs: 1_000,
    });
    await t.mutation(internal.listen.setJobStatus, {
      sourceKey,
      status: "ready",
    });
    await t.mutation(internal.listen.insertChunk, {
      sourceKey,
      chunkIndex: 0,
      segments: [
        { startMs: 0, endMs: 1_000, text: "line", words: [] },
      ],
    });
    // requestProcessing unions every category into the required keys, so
    // full coverage means decisions for all six.
    for (const key of [
      "profanity",
      "slurs",
      "sexual",
      "drugs",
      "violence",
      "blasphemy",
    ]) {
      await t.mutation(internal.listen.storeDecisions, {
        sourceKey,
        questionKey: key,
        chunkIndex: 0,
        probs: [0.1],
      });
    }
    // Categories already covered: stays ready.
    const covered = await asUser.mutation(api.listen.requestProcessing, {
      source: { kind: "audius", trackId: "requeue" },
      questionKeys: ["profanity"],
    });
    expect(covered.status).toBe("ready");
    // New topic key is missing coverage: job requeues.
    const missing = await asUser.mutation(api.listen.requestProcessing, {
      source: { kind: "audius", trackId: "requeue" },
      questionKeys: ["topic:bees"],
    });
    expect(missing.status).toBe("queued");
  });
});
