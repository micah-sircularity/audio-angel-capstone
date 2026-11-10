/**
 * Audio-native lane: pick an Audius track or podcast episode, transcribe
 * the real audio with Deepgram, classify every segment with the Jev
 * decision model on OpenRouter, and cache both in Convex tables so the
 * client watches progress in realtime.
 *
 * Flow: requestProcessing (mutation, dedupes + schedules) ->
 * runPipeline (internal action: resolve -> transcribe -> classify) ->
 * status/transcript/decisions (public queries for the UI).
 */

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  action,
  env,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type DatabaseReader,
} from "./_generated/server";
import { v } from "convex/values";
import * as audius from "./lib/audius";
import { transcribeUrl, type TranscriptSegment } from "./lib/deepgram";
import { searchPodcasts as searchItunes } from "./lib/itunes";
import { decide, type DecisionState } from "./lib/jev";
import {
  ACTIVE_JOB_STATUSES,
  DECISION_CONCURRENCY,
  jobStatusValidator,
  PIPELINE_VERSION,
  SEGMENTS_PER_CHUNK,
  sourceKeyFor,
  sourceValidator,
  type Source,
} from "./lib/pipeline";
import {
  CATEGORY_KEYS,
  CATEGORY_KEY_SET,
  normalizeTopic,
  questionForKey,
} from "./lib/questions";
import { assertSafeUrl } from "./lib/safeFetch";
import { listEpisodes as fetchEpisodes } from "./lib/rss";

const MAX_QUESTION_KEYS = 20;
const MAX_CHUNKS = 400;
const MAX_DECISION_ROWS = 4000;

/**
 * Keeps client-supplied question keys: category keys verbatim, `topic:*`
 * keys re-normalized (trim, collapse whitespace, cap 80 chars). The
 * categories are always unioned in so cached decisions serve any profile.
 */
function sanitizeQuestionKeys(keys: string[]): string[] {
  const accepted: string[] = [];
  for (const key of keys.slice(0, MAX_QUESTION_KEYS)) {
    if (CATEGORY_KEY_SET.has(key)) {
      accepted.push(key);
    } else if (key.startsWith("topic:")) {
      const topic = normalizeTopic(key.slice("topic:".length));
      if (topic) accepted.push(`topic:${topic}`);
    }
  }
  return [...new Set([...accepted, ...CATEGORY_KEYS])];
}

async function findJob(
  ctx: { db: DatabaseReader },
  sourceKey: string,
): Promise<Doc<"processingJobs"> | null> {
  return await ctx.db
    .query("processingJobs")
    .withIndex("by_sourceKey_and_pipelineVersion", (q) =>
      q.eq("sourceKey", sourceKey).eq("pipelineVersion", PIPELINE_VERSION),
    )
    .first();
}

// ---------------------------------------------------------------------------
// Public read API
// ---------------------------------------------------------------------------

/** Latest known source document + pipeline job for a sourceKey. */
export const status = query({
  args: { sourceKey: v.string() },
  handler: async (ctx, args) => {
    const source = await ctx.db
      .query("audioSources")
      .withIndex("by_sourceKey", (q) => q.eq("sourceKey", args.sourceKey))
      .first();
    const job = await findJob(ctx, args.sourceKey);
    return { source, job };
  },
});

/** Stored transcript chunks for the current pipeline version. */
export const transcript = query({
  args: { sourceKey: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("transcriptChunks")
      .withIndex("by_sourceKey_and_pipelineVersion", (q) =>
        q
          .eq("sourceKey", args.sourceKey)
          .eq("pipelineVersion", PIPELINE_VERSION),
      )
      .take(MAX_CHUNKS);
    rows.sort((a, b) => a.chunkIndex - b.chunkIndex);
    return {
      pipelineVersion: PIPELINE_VERSION,
      chunks: rows.map((row) => ({
        chunkIndex: row.chunkIndex,
        segments: row.segments,
      })),
    };
  },
});

/** Stored per-question probabilities for the current pipeline version. */
export const decisions = query({
  args: { sourceKey: v.string(), questionKeys: v.array(v.string()) },
  handler: async (ctx, args) => {
    const wanted = new Set(args.questionKeys);
    const rows = await ctx.db
      .query("chunkDecisions")
      .withIndex("by_sourceKey_and_pipelineVersion_and_questionKey", (q) =>
        q
          .eq("sourceKey", args.sourceKey)
          .eq("pipelineVersion", PIPELINE_VERSION),
      )
      .take(MAX_DECISION_ROWS);
    const byQuestion: Record<
      string,
      { chunkIndex: number; probs: number[] }[]
    > = {};
    for (const key of wanted) byQuestion[key] = [];
    for (const row of rows) {
      if (!wanted.has(row.questionKey)) continue;
      byQuestion[row.questionKey].push({
        chunkIndex: row.chunkIndex,
        probs: row.probs,
      });
    }
    for (const list of Object.values(byQuestion)) {
      list.sort((a, b) => a.chunkIndex - b.chunkIndex);
    }
    return { pipelineVersion: PIPELINE_VERSION, byQuestion };
  },
});

// ---------------------------------------------------------------------------
// Public discovery actions (no auth needed; external read-only APIs)
// ---------------------------------------------------------------------------

/** Audius track search; an empty query returns the trending list. */
export const searchAudius = action({
  args: { query: v.string() },
  handler: async (_ctx, args) => {
    const tracks = await audius.searchTracks(fetch, args.query);
    return tracks.map((track) => ({
      ...track,
      sourceKey: `aud:${track.trackId}`,
    }));
  },
});

/** iTunes podcast directory search (display-only results). */
export const searchPodcasts = action({
  args: { query: v.string() },
  handler: async (_ctx, args) => {
    return await searchItunes(args.query);
  },
});

/** Episode list for a podcast feed, fetched through the SSRF guard. */
export const listEpisodes = action({
  args: { feedUrl: v.string() },
  handler: async (_ctx, args) => {
    assertSafeUrl(args.feedUrl);
    return await fetchEpisodes(args.feedUrl);
  },
});

// ---------------------------------------------------------------------------
// requestProcessing: auth'd entry point that dedupes and schedules the
// pipeline. Runs in a mutation so the check + schedule is atomic.
// ---------------------------------------------------------------------------

export const requestProcessing = mutation({
  args: {
    source: sourceValidator,
    questionKeys: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Sign in to process audio.");
    const questionKeys = sanitizeQuestionKeys(args.questionKeys);
    const sourceKey = await sourceKeyFor(args.source);
    const job = await findJob(ctx, sourceKey);
    if (job && ACTIVE_JOB_STATUSES.has(job.status)) {
      // A run is already scheduled or in flight; return its status.
      return { sourceKey, status: job.status };
    }
    if (job?.status === "ready") {
      const missing = await missingQuestionKeys(ctx, sourceKey, questionKeys);
      if (missing.length === 0) return { sourceKey, status: "ready" };
      // Transcript is cached; only classify the new question keys.
      await ctx.db.patch(job._id, {
        status: "queued",
        error: undefined,
        updatedAt: Date.now(),
      });
      await ctx.scheduler.runAfter(0, internal.listen.runPipeline, {
        sourceKey,
        source: args.source,
        questionKeys,
      });
      return { sourceKey, status: "queued" };
    }
    // Failed or missing job: (re)queue and kick off a fresh run.
    if (job) {
      await ctx.db.patch(job._id, {
        status: "queued",
        progressDone: 0,
        progressTotal: undefined,
        error: undefined,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("processingJobs", {
        sourceKey,
        pipelineVersion: PIPELINE_VERSION,
        status: "queued",
        progressDone: 0,
        updatedAt: Date.now(),
      });
    }
    await ctx.scheduler.runAfter(0, internal.listen.runPipeline, {
      sourceKey,
      source: args.source,
      questionKeys,
    });
    return { sourceKey, status: "queued" };
  },
});

/**
 * Which of `questionKeys` still lack decisions covering every stored
 * transcript chunk. Used when a ready job is asked for extra questions.
 */
async function missingQuestionKeys(
  ctx: { db: DatabaseReader },
  sourceKey: string,
  questionKeys: string[],
): Promise<string[]> {
  const chunks = await ctx.db
    .query("transcriptChunks")
    .withIndex("by_sourceKey_and_pipelineVersion", (q) =>
      q.eq("sourceKey", sourceKey).eq("pipelineVersion", PIPELINE_VERSION),
    )
    .take(MAX_CHUNKS);
  if (chunks.length === 0) return questionKeys;
  const needed = new Set(chunks.map((chunk) => chunk.chunkIndex));
  const missing: string[] = [];
  for (const key of questionKeys) {
    const rows = await ctx.db
      .query("chunkDecisions")
      .withIndex("by_sourceKey_and_pipelineVersion_and_questionKey", (q) =>
        q
          .eq("sourceKey", sourceKey)
          .eq("pipelineVersion", PIPELINE_VERSION)
          .eq("questionKey", key),
      )
      .take(MAX_CHUNKS);
    const have = new Set(rows.map((row) => row.chunkIndex));
    if ([...needed].some((index) => !have.has(index))) missing.push(key);
  }
  return missing;
}

// ---------------------------------------------------------------------------
// Internal database helpers (kept small and specific)
// ---------------------------------------------------------------------------

/** Insert or update the audioSources document for a sourceKey. */
export const upsertSource = internalMutation({
  args: {
    sourceKey: v.string(),
    kind: v.union(v.literal("audius"), v.literal("podcast")),
    audiusTrackId: v.optional(v.string()),
    feedUrl: v.optional(v.string()),
    episodeGuid: v.optional(v.string()),
    title: v.string(),
    artist: v.string(),
    durationMs: v.number(),
    artworkUrl: v.optional(v.string()),
    enclosureUrl: v.optional(v.string()),
    contentId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { sourceKey, ...fields } = args;
    const existing = await ctx.db
      .query("audioSources")
      .withIndex("by_sourceKey", (q) => q.eq("sourceKey", sourceKey))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }
    return await ctx.db.insert("audioSources", { sourceKey, ...fields });
  },
});

/** Store one transcript chunk; skips a chunkIndex that already exists. */
export const insertChunk = internalMutation({
  args: {
    sourceKey: v.string(),
    chunkIndex: v.number(),
    segments: v.array(
      v.object({
        startMs: v.number(),
        endMs: v.number(),
        text: v.string(),
        words: v.array(
          v.object({
            startMs: v.number(),
            endMs: v.number(),
            text: v.string(),
          }),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("transcriptChunks")
      .withIndex("by_sourceKey_and_pipelineVersion", (q) =>
        q
          .eq("sourceKey", args.sourceKey)
          .eq("pipelineVersion", PIPELINE_VERSION),
      )
      .filter((q) => q.eq(q.field("chunkIndex"), args.chunkIndex))
      .take(1);
    if (existing.length > 0) return existing[0]._id;
    return await ctx.db.insert("transcriptChunks", {
      sourceKey: args.sourceKey,
      pipelineVersion: PIPELINE_VERSION,
      chunkIndex: args.chunkIndex,
      segments: args.segments,
    });
  },
});

/** Store noul probs for one (questionKey, chunkIndex); skips duplicates. */
export const storeDecisions = internalMutation({
  args: {
    sourceKey: v.string(),
    questionKey: v.string(),
    chunkIndex: v.number(),
    probs: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("chunkDecisions")
      .withIndex("by_sourceKey_and_pipelineVersion_and_questionKey", (q) =>
        q
          .eq("sourceKey", args.sourceKey)
          .eq("pipelineVersion", PIPELINE_VERSION)
          .eq("questionKey", args.questionKey),
      )
      .filter((q) => q.eq(q.field("chunkIndex"), args.chunkIndex))
      .take(1);
    if (existing.length > 0) return existing[0]._id;
    return await ctx.db.insert("chunkDecisions", {
      sourceKey: args.sourceKey,
      pipelineVersion: PIPELINE_VERSION,
      questionKey: args.questionKey,
      chunkIndex: args.chunkIndex,
      probs: args.probs,
    });
  },
});

/** Set a job's status (creating the row if needed) and clear stale errors. */
export const setJobStatus = internalMutation({
  args: {
    sourceKey: v.string(),
    status: jobStatusValidator,
  },
  handler: async (ctx, args) => {
    const job = await findJob(ctx, args.sourceKey);
    if (!job) {
      return await ctx.db.insert("processingJobs", {
        sourceKey: args.sourceKey,
        pipelineVersion: PIPELINE_VERSION,
        status: args.status,
        updatedAt: Date.now(),
      });
    }
    await ctx.db.patch(job._id, {
      status: args.status,
      error: args.status === "failed" ? job.error : undefined,
      updatedAt: Date.now(),
    });
    return job._id;
  },
});

/** Update progress counters shown by the realtime "Listening…" UI. */
export const setJobProgress = internalMutation({
  args: {
    sourceKey: v.string(),
    progressDone: v.number(),
    progressTotal: v.number(),
  },
  handler: async (ctx, args) => {
    const job = await findJob(ctx, args.sourceKey);
    if (!job) return null;
    await ctx.db.patch(job._id, {
      progressDone: args.progressDone,
      progressTotal: args.progressTotal,
      updatedAt: Date.now(),
    });
    return job._id;
  },
});

/** Mark a job failed with the pipeline error message. */
export const failJob = internalMutation({
  args: { sourceKey: v.string(), error: v.string() },
  handler: async (ctx, args) => {
    const job = await findJob(ctx, args.sourceKey);
    if (!job) {
      return await ctx.db.insert("processingJobs", {
        sourceKey: args.sourceKey,
        pipelineVersion: PIPELINE_VERSION,
        status: "failed",
        error: args.error,
        updatedAt: Date.now(),
      });
    }
    await ctx.db.patch(job._id, {
      status: "failed",
      error: args.error,
      updatedAt: Date.now(),
    });
    return job._id;
  },
});

// ---------------------------------------------------------------------------
// Internal queries used by the pipeline action (actions have no ctx.db)
// ---------------------------------------------------------------------------

/** All transcript chunks for a sourceKey, ordered by chunkIndex. */
export const getChunks = internalQuery({
  args: { sourceKey: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("transcriptChunks")
      .withIndex("by_sourceKey_and_pipelineVersion", (q) =>
        q
          .eq("sourceKey", args.sourceKey)
          .eq("pipelineVersion", PIPELINE_VERSION),
      )
      .take(MAX_CHUNKS);
    rows.sort((a, b) => a.chunkIndex - b.chunkIndex);
    return rows.map((row) => ({
      chunkIndex: row.chunkIndex,
      segments: row.segments,
    }));
  },
});

/** Existing (questionKey, chunkIndex) decision pairs for a sourceKey. */
export const getDecisionIndex = internalQuery({
  args: { sourceKey: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("chunkDecisions")
      .withIndex("by_sourceKey_and_pipelineVersion_and_questionKey", (q) =>
        q
          .eq("sourceKey", args.sourceKey)
          .eq("pipelineVersion", PIPELINE_VERSION),
      )
      .take(MAX_DECISION_ROWS);
    return rows.map((row) => ({
      questionKey: row.questionKey,
      chunkIndex: row.chunkIndex,
    }));
  },
});

// ---------------------------------------------------------------------------
// runPipeline: resolve -> transcribe -> classify. Idempotent-ish: stored
// chunks and decisions are reused, so reruns only fill what's missing.
// ---------------------------------------------------------------------------

const STATE_INSTRUCTION =
  "Judge only the text in 'line'. 'before' and 'after' are context only.";

export const runPipeline = internalAction({
  args: {
    sourceKey: v.string(),
    source: sourceValidator,
    questionKeys: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      await ctx.runMutation(internal.listen.setJobStatus, {
        sourceKey: args.sourceKey,
        status: "resolving",
      });
      const audioUrl = await resolveAudioUrl(ctx, args);

      // Transcribe only when this version has no cached chunks.
      const existing: { chunkIndex: number; segments: TranscriptSegment[] }[] =
        await ctx.runQuery(internal.listen.getChunks, {
          sourceKey: args.sourceKey,
        });
      const segsByIndex = new Map<number, TranscriptSegment[]>();
      if (existing.length === 0) {
        await ctx.runMutation(internal.listen.setJobStatus, {
          sourceKey: args.sourceKey,
          status: "transcribing",
        });
        const deepgramKey = env.DEEPGRAM_API_KEY;
        if (!deepgramKey) throw new Error("Transcription is not configured");
        const result = await transcribeUrl(fetch, deepgramKey, audioUrl);
        const chunks = chunkSegments(result.segments, SEGMENTS_PER_CHUNK);
        for (let index = 0; index < chunks.length; index++) {
          await ctx.runMutation(internal.listen.insertChunk, {
            sourceKey: args.sourceKey,
            chunkIndex: index,
            segments: chunks[index],
          });
          segsByIndex.set(index, chunks[index]);
        }
      } else {
        for (const chunk of existing) {
          segsByIndex.set(chunk.chunkIndex, chunk.segments);
        }
      }
      const chunkIndexes = [...segsByIndex.keys()].sort((a, b) => a - b);

      // Classify every missing (questionKey, chunkIndex) pair.
      await ctx.runMutation(internal.listen.setJobStatus, {
        sourceKey: args.sourceKey,
        status: "classifying",
      });
      const openrouterKey = env.OPENROUTER_API_KEY;
      if (!openrouterKey) throw new Error("Classification is not configured");
      const decisionIndex: { questionKey: string; chunkIndex: number }[] =
        await ctx.runQuery(internal.listen.getDecisionIndex, {
          sourceKey: args.sourceKey,
        });
      const have = new Set(
        decisionIndex.map((row) => `${row.questionKey}${row.chunkIndex}`),
      );
      const work: { questionKey: string; chunkIndex: number }[] = [];
      for (const questionKey of new Set(args.questionKeys)) {
        if (!questionForKey(questionKey)) continue;
        for (const chunkIndex of chunkIndexes) {
          if (!have.has(`${questionKey}${chunkIndex}`)) {
            work.push({ questionKey, chunkIndex });
          }
        }
      }
      const total = work.length;
      let done = 0;
      await ctx.runMutation(internal.listen.setJobProgress, {
        sourceKey: args.sourceKey,
        progressDone: 0,
        progressTotal: total,
      });
      const kind = args.source.kind === "audius" ? "music" : "speech";
      let firstError: unknown = null;
      await workerPool(work, DECISION_CONCURRENCY, async (item) => {
        if (firstError) return;
        try {
          const probs = await classifyChunk(
            openrouterKey,
            kind,
            item.questionKey,
            segsByIndex.get(item.chunkIndex) ?? [],
          );
          await ctx.runMutation(internal.listen.storeDecisions, {
            sourceKey: args.sourceKey,
            questionKey: item.questionKey,
            chunkIndex: item.chunkIndex,
            probs,
          });
          done += 1;
          await ctx.runMutation(internal.listen.setJobProgress, {
            sourceKey: args.sourceKey,
            progressDone: done,
            progressTotal: total,
          });
        } catch (error) {
          firstError = firstError ?? error;
        }
      });
      if (firstError) throw firstError;
      await ctx.runMutation(internal.listen.setJobStatus, {
        sourceKey: args.sourceKey,
        status: "ready",
      });
      return null;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      try {
        await ctx.runMutation(internal.listen.failJob, {
          sourceKey: args.sourceKey,
          error: message.slice(0, 500),
        });
      } catch {
        // Failing the job must never mask the original pipeline error.
      }
      return null;
    }
  },
});

/**
 * Resolves a pick to a fetchable audio URL and upserts audioSources.
 * Returns the audio URL Deepgram should transcribe.
 */
async function resolveAudioUrl(
  ctx: ActionCtx,
  args: { sourceKey: string; source: Source },
): Promise<string> {
  const source = args.source;
  if (source.kind === "audius") {
    const track = await audius.getTrack(fetch, source.trackId);
    if (!track.isStreamable) {
      throw new Error("This Audius track is not streamable.");
    }
    const audioUrl = await audius.streamUrl(fetch, source.trackId);
    await ctx.runMutation(internal.listen.upsertSource, {
      sourceKey: args.sourceKey,
      kind: "audius",
      audiusTrackId: track.trackId,
      title: track.title,
      artist: track.artist,
      durationMs: track.durationMs,
      artworkUrl: track.artworkUrl,
      contentId: track.contentId,
    });
    return audioUrl;
  }
  const feed = await fetchEpisodes(source.feedUrl);
  const episode = feed.episodes.find((item) => item.guid === source.guid);
  if (!episode || !episode.enclosureUrl) {
    throw new Error("episode-not-found");
  }
  await ctx.runMutation(internal.listen.upsertSource, {
    sourceKey: args.sourceKey,
    kind: "podcast",
    feedUrl: source.feedUrl,
    episodeGuid: episode.guid,
    title: episode.title,
    artist: feed.title,
    durationMs: episode.durationMs ?? 0,
    artworkUrl: feed.imageUrl,
    enclosureUrl: episode.enclosureUrl,
  });
  return episode.enclosureUrl;
}

/** Split a flat segment list into fixed-size chunks for storage/work. */
function chunkSegments(
  segments: TranscriptSegment[],
  perChunk: number,
): TranscriptSegment[][] {
  const chunks: TranscriptSegment[][] = [];
  for (let i = 0; i < segments.length; i += perChunk) {
    chunks.push(segments.slice(i, i + perChunk));
  }
  return chunks;
}

/**
 * Runs one Jev decision per segment for a single question key; probs
 * aligns 1:1 with the chunk's segments.
 */
async function classifyChunk(
  apiKey: string,
  kind: "music" | "speech",
  questionKey: string,
  segments: TranscriptSegment[],
): Promise<number[]> {
  const question = questionForKey(questionKey);
  if (!question) {
    throw new Error(`Unknown question key: ${questionKey}`);
  }
  const probs: number[] = [];
  for (let i = 0; i < segments.length; i++) {
    const state: DecisionState = {
      kind,
      instruction: STATE_INSTRUCTION,
      before: segments[i - 1]?.text ?? "",
      line: segments[i].text,
      after: segments[i + 1]?.text ?? "",
    };
    const { answers } = await decide(fetch, apiKey, state, { q: question });
    probs.push(answers.q);
  }
  return probs;
}

/** Minimal bounded worker pool over a work list. */
async function workerPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (next < items.length) {
        const item = items[next];
        next += 1;
        await worker(item);
      }
    },
  );
  await Promise.all(workers);
}
