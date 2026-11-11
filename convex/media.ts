import { v } from "convex/values";
import schema from "./schema";
import {
  mutation,
  query,
  internalAction,
  internalMutation,
  internalQuery,
  env,
} from "./_generated/server";
import { internal, components } from "./_generated/api";
import { WorkflowManager, vWorkflowId } from "@convex-dev/workflow";
const preparationWorkflow = new WorkflowManager(components.workflow, {
  workpoolOptions: { maxParallelism: 2, retryActionsByDefault: false },
});
import type { Doc } from "./_generated/dataModel";
import { sourceValidator, sourceKeyFor } from "./lib/pipeline";
import * as audius from "./lib/audius";
import { listEpisodes } from "./lib/rss";
import { safeFetch } from "./lib/safeFetch";
import { transcribeUrl } from "./lib/deepgram";
import {
  MEDIA_VERSION,
  DEFAULT_BLOCKED_WORDS,
  normalizeWord,
  planWords,
} from "./lib/mediaPlan";
import { mediaStage, mediaTimes, mediaWord } from "./lib/mediaValidators";

const assetDoc = v.object({
  ...schema.tables.mediaAssets.validator.fields,
  _id: v.id("mediaAssets"),
  _creationTime: v.number(),
});
const mixDoc = v.object({
  ...schema.tables.mediaMixes.validator.fields,
  _id: v.id("mediaMixes"),
  _creationTime: v.number(),
});
const MAX_BYTES = 24 * 1024 * 1024;
const LEASE_MS = 12 * 60 * 1000;
const hash = async (value: ArrayBuffer) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", value)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
const errorMessage = (e: unknown) =>
  e instanceof Error
    ? e.message.slice(0, 400)
    : "Audio processing failed. Retry preparation.";

export const start = mutation({
  args: { source: sourceValidator },
  returns: v.id("mediaAssets"),
  handler: async (ctx, { source }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw Error("Sign in to prepare audio.");
    const sourceKey = await sourceKeyFor(source);
    const existing = await ctx.db
      .query("mediaAssets")
      .withIndex("by_owner_and_sourceKey_and_version", (q) =>
        q
          .eq("owner", identity.tokenIdentifier)
          .eq("sourceKey", sourceKey)
          .eq("version", MEDIA_VERSION),
      )
      .unique();
    if (
      existing &&
      (existing.stage === "review" ||
        (existing.stage !== "failed" &&
          Date.now() - existing.updatedAt < LEASE_MS))
    )
      return existing._id;
    const attempt = (existing?.attempt ?? 0) + 1;
    const assetId = existing
      ? existing._id
      : await ctx.db.insert("mediaAssets", {
          owner: identity.tokenIdentifier,
          sourceKey,
          version: MEDIA_VERSION,
          kind: source.kind === "audius" ? "music" : "podcast",
          stage: "queued",
          attempt,
          updatedAt: Date.now(),
          startedAt: Date.now(),
          timings: {},
        });
    if (existing)
      await ctx.db.patch(assetId, {
        stage: "queued",
        attempt,
        error: undefined,
        startedAt: Date.now(),
        updatedAt: Date.now(),
      });
    await preparationWorkflow.start(
      ctx,
      internal.media.prepareWorkflow,
      {
        assetId,
        attempt,
        source,
      },
      {
        onComplete: internal.media.workflowFinished,
        context: { kind: "asset", id: assetId, attempt },
      },
    );
    return assetId;
  },
});

export const read = query({
  args: { assetId: v.id("mediaAssets"), mixId: v.optional(v.id("mediaMixes")) },
  returns: v.union(
    v.null(),
    v.object({
      asset: assetDoc,
      mix: v.union(v.null(), mixDoc),
      originalUrl: v.union(v.null(), v.string()),
      mixUrl: v.union(v.null(), v.string()),
      defaultWords: v.array(v.string()),
    }),
  ),
  handler: async (ctx, { assetId, mixId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const asset = await ctx.db.get(assetId);
    if (!asset || asset.owner !== identity.tokenIdentifier) return null;
    const candidate = mixId ? await ctx.db.get(mixId) : null;
    const mix =
      candidate?.owner === identity.tokenIdentifier &&
      candidate.assetId === assetId
        ? candidate
        : null;
    return {
      asset,
      mix,
      originalUrl: asset.originalId
        ? await ctx.storage.getUrl(asset.originalId)
        : null,
      mixUrl:
        mix?.stage === "ready" && mix.fileId
          ? await ctx.storage.getUrl(mix.fileId)
          : null,
      defaultWords: DEFAULT_BLOCKED_WORDS,
    };
  },
});

export const asset = internalQuery({
  args: { assetId: v.id("mediaAssets") },
  returns: v.union(v.null(), assetDoc),
  handler: async (ctx, a) => await ctx.db.get(a.assetId),
});
export const preparationState = internalQuery({
  args: { assetId: v.id("mediaAssets") },
  returns: v.union(
    v.null(),
    v.object({ stage: mediaStage, attempt: v.number() }),
  ),
  handler: async (ctx, { assetId }) => {
    const row = await ctx.db.get(assetId);
    return row ? { stage: row.stage, attempt: row.attempt } : null;
  },
});
export const mix = internalQuery({
  args: { mixId: v.id("mediaMixes") },
  returns: v.union(v.null(), mixDoc),
  handler: async (ctx, a) => await ctx.db.get(a.mixId),
});
export const progress = internalMutation({
  args: {
    assetId: v.id("mediaAssets"),
    attempt: v.number(),
    stage: v.optional(mediaStage),
    title: v.optional(v.string()),
    error: v.optional(v.string()),
    originalId: v.optional(v.id("_storage")),
    sourceHash: v.optional(v.string()),
    vocalsId: v.optional(v.string()),
    instrumentalId: v.optional(v.string()),
    isPreview: v.optional(v.boolean()),
    sourceDurationMs: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    frames: v.optional(v.number()),
    gain: v.optional(v.number()),
    words: v.optional(v.array(mediaWord)),
    timings: v.optional(mediaTimes),
  },
  returns: v.boolean(),
  handler: async (
    ctx,
    { assetId, attempt, timings, vocalsId, instrumentalId, ...fields },
  ) => {
    const row = await ctx.db.get(assetId);
    if (!row || row.attempt !== attempt) return false;
    const voice = vocalsId
      ? ctx.db.system.normalizeId("_storage", vocalsId)
      : undefined;
    const beat = instrumentalId
      ? ctx.db.system.normalizeId("_storage", instrumentalId)
      : undefined;
    if ((vocalsId && !voice) || (instrumentalId && !beat))
      throw Error("Invalid storage receipt");
    await ctx.db.patch(assetId, {
      ...fields,
      ...(voice ? { vocalsId: voice } : {}),
      ...(beat ? { instrumentalId: beat } : {}),
      timings: {
        ...row.timings,
        ...timings,
        ...(fields.stage === "review"
          ? {
              last_prepare_request_s:
                (Date.now() - (row.startedAt ?? row._creationTime)) / 1000,
            }
          : {}),
      },
      updatedAt: Date.now(),
    });
    return true;
  },
});

async function cappedAudio(url: string) {
  const response = await safeFetch(url, { timeoutMs: 120000 });
  if (!response.ok) {
    await response.body?.cancel();
    throw Error(
      response.status === 401 || response.status === 403
        ? "The audio host denied access to this recording. Choose another source."
        : `The audio host returned ${response.status}. Try again later.`,
    );
  }
  const size = Number(response.headers.get("content-length"));
  if (size > MAX_BYTES) {
    await response.body?.cancel();
    throw Error("This release supports recordings up to 24 MiB.");
  }
  if (!response.body)
    throw Error("The audio host returned an empty recording.");
  const reader = response.body.getReader();
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.length;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw Error("This release supports recordings up to 24 MiB.");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!total) throw Error("The audio host returned an empty recording.");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return new Blob([bytes], {
    type:
      response.headers.get("content-type")?.split(";")[0] ??
      "application/octet-stream",
  });
}

async function worker(
  url: string | undefined,
  payload: unknown,
): Promise<unknown> {
  if (!url || !env.MEDIA_WORKER_TOKEN)
    throw Error("Audio processing worker is not configured.");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.MEDIA_WORKER_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(240000),
  });
  if (!response.ok)
    throw Error(`Audio worker returned ${response.status}. Retry preparation.`);
  return await response.json();
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") throw Error("Invalid worker result");
  return Object.fromEntries(Object.entries(value));
}
function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw Error("Invalid worker number");
  return value;
}
function string(value: unknown): string {
  if (typeof value !== "string" || !value) throw Error("Invalid worker file");
  return value;
}

export const prepareWorkflow = preparationWorkflow.define({
  args: {
    assetId: v.id("mediaAssets"),
    attempt: v.number(),
    source: sourceValidator,
  },
  returns: v.null(),
  handler: async (step, args): Promise<null> => {
    for (const phase of ["save", "separate", "transcribe"] as const) {
      await step.runAction(
        internal.media.prepare,
        { ...args, phase },
        { retry: false },
      );
      const current: { stage: string; attempt: number } | null =
        await step.runQuery(internal.media.preparationState, {
          assetId: args.assetId,
        });
      if (
        !current ||
        current.attempt !== args.attempt ||
        current.stage === "failed"
      )
        return null;
    }
    return null;
  },
});

export const prepare = internalAction({
  args: {
    phase: v.union(
      v.literal("save"),
      v.literal("separate"),
      v.literal("transcribe"),
    ),
    assetId: v.id("mediaAssets"),
    attempt: v.number(),
    source: sourceValidator,
  },
  returns: v.null(),
  handler: async (ctx, { assetId, attempt, source, phase }) => {
    const begin = Date.now();
    try {
      let row: Doc<"mediaAssets"> | null = await ctx.runQuery(
        internal.media.asset,
        { assetId },
      );
      if (!row || row.attempt !== attempt) return null;
      if (!row.originalId && phase === "save") {
        if (
          !(await ctx.runMutation(internal.media.progress, {
            assetId,
            attempt,
            stage: "resolving",
          }))
        )
          return null;
        let url: string, title: string, durationMs: number;
        if (source.kind === "audius") {
          const track = await audius.getTrack(fetch, source.trackId);
          if (!track.isStreamable) throw Error("This track is not streamable.");
          url = await audius.streamUrl(fetch, source.trackId);
          title = track.title;
          durationMs = track.durationMs;
        } else {
          const feed = await listEpisodes(source.feedUrl);
          const episode = feed.episodes.find((e) => e.guid === source.guid);
          if (!episode?.enclosureUrl)
            throw Error("Episode not found in this feed.");
          url = episode.enclosureUrl;
          title = episode.title;
          durationMs = episode.durationMs ?? 0;
        }
        if (source.kind === "audius" && durationMs > 1800000)
          throw Error("This release supports recordings up to 30 minutes.");
        await ctx.runMutation(internal.media.progress, {
          assetId,
          attempt,
          stage: "downloading",
          title,
        });
        const t = Date.now();
        if (source.kind === "podcast") {
          const result = record(
            await worker(env.MEDIA_PREVIEW_URL, {
              sourceUrl: url,
              uploadUrl: await ctx.storage.generateUploadUrl(),
            }),
          );
          await ctx.runMutation(internal.media.savePreview, {
            assetId,
            attempt,
            fileId: string(result.fileId),
            sourceHash: string(result.sourceHash),
            durationMs: number(result.durationMs),
            sourceDurationMs: number(result.sourceDurationMs),
            isPreview: result.isPreview === true,
            timings: {
              download_s: number(result.download_s),
              preview_encode_s: number(result.preview_encode_s),
              preview_request_s: (Date.now() - t) / 1000,
            },
          });
        } else {
          const blob = await cappedAudio(url);
          const sourceHash = await hash(await blob.arrayBuffer());
          const originalId = await ctx.storage.store(blob);
          await ctx.runMutation(internal.media.progress, {
            assetId,
            attempt,
            originalId,
            sourceHash,
            durationMs,
            timings: { download_s: (Date.now() - t) / 1000 },
          });
        }
        row = await ctx.runQuery(internal.media.asset, { assetId });
      }
      if (!row?.originalId || row.attempt !== attempt) return null;
      if (phase === "save") return null;
      const sourceUrl = await ctx.storage.getUrl(row.originalId);
      if (!sourceUrl) throw Error("Saved recording is missing.");
      if (
        phase === "separate" &&
        row.kind === "music" &&
        (!row.vocalsId || !row.instrumentalId)
      ) {
        await ctx.runMutation(internal.media.progress, {
          assetId,
          attempt,
          stage: "separating",
        });
        const t = Date.now();
        const result = record(
          await worker(env.MEDIA_SEPARATE_URL, {
            sourceUrl,
            sourceHash: row.sourceHash,
            vocalsUploadUrl: await ctx.storage.generateUploadUrl(),
            instrumentalUploadUrl: await ctx.storage.generateUploadUrl(),
          }),
        );
        // Storage IDs are validated by the internal mutation before they enter the database.
        await ctx.runMutation(internal.media.progress, {
          assetId,
          attempt,
          vocalsId: string(result.vocals),
          instrumentalId: string(result.instrumental),
          durationMs: Math.round(number(result.duration) * 1000),
          frames: number(result.frames),
          gain: number(result.gain),
          timings: {
            separation_s: number(result.separation_s),
            separation_request_s: (Date.now() - t) / 1000,
          },
        });
        row = await ctx.runQuery(internal.media.asset, { assetId });
      }
      if (!row || row.attempt !== attempt) return null;
      if (phase === "separate") return null;
      if (!row.words) {
        await ctx.runMutation(internal.media.progress, {
          assetId,
          attempt,
          stage: "transcribing",
        });
        const url = row.vocalsId
          ? await ctx.storage.getUrl(row.vocalsId)
          : sourceUrl;
        if (!url || !env.DEEPGRAM_API_KEY)
          throw Error("Transcription is not configured.");
        const t = Date.now();
        const transcript = await transcribeUrl(
          fetch,
          env.DEEPGRAM_API_KEY,
          url,
        );
        if (row.kind === "music" && transcript.durationMs > 1800150)
          throw Error("This release supports recordings up to 30 minutes.");
        const words = transcript.segments
          .flatMap((s) => s.words)
          .filter((w) => w.startMs < 1800000)
          .map((w) => ({ ...w, endMs: Math.min(w.endMs, 1800000) }));
        if (
          words.length > 10000 ||
          new TextEncoder().encode(JSON.stringify(words)).length > 750000
        )
          throw Error("This preview exceeds the transcript storage limit.");
        await ctx.runMutation(internal.media.progress, {
          assetId,
          attempt,
          words,
          durationMs:
            row.kind === "music"
              ? row.durationMs
              : Math.min(transcript.durationMs, row.durationMs || 1800000),
          gain: row.gain ?? 0.98,
          timings: { transcription_s: (Date.now() - t) / 1000 },
        });
      }
      await ctx.runMutation(internal.media.progress, {
        assetId,
        attempt,
        stage: "review",
        timings: { last_step_request_s: (Date.now() - begin) / 1000 },
      });
    } catch (e) {
      await ctx.runMutation(internal.media.progress, {
        assetId,
        attempt,
        stage: "failed",
        error: errorMessage(e),
      });
    }
    return null;
  },
});

export const requestMix = mutation({
  args: { assetId: v.id("mediaAssets"), words: v.array(v.string()) },
  returns: v.id("mediaMixes"),
  handler: async (ctx, { assetId, words }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw Error("Sign in to render audio.");
    const asset = await ctx.db.get(assetId);
    if (!asset || asset.owner !== identity.tokenIdentifier)
      throw Error("Recording not found.");
    if (
      asset.stage !== "review" ||
      !asset.words ||
      !asset.sourceHash ||
      !asset.durationMs
    )
      throw Error("Prepare this recording first.");
    if (words.length > 100 || words.some((w) => w.length > 40))
      throw Error(
        "Choose at most 100 individual words, each up to 40 characters.",
      );
    const normalized = [
      ...new Set(words.map(normalizeWord).filter(Boolean)),
    ].sort();
    const plan = planWords(asset.words, normalized, asset.durationMs);
    const key = await hash(
      new TextEncoder().encode(
        JSON.stringify({
          version: MEDIA_VERSION,
          source: asset.sourceHash,
          assetId,
          gain: asset.gain,
          normalized,
          intervals: plan.intervals,
        }),
      ).buffer,
    );
    const old = await ctx.db
      .query("mediaMixes")
      .withIndex("by_owner_and_key", (q) =>
        q.eq("owner", identity.tokenIdentifier).eq("key", key),
      )
      .unique();
    if (
      old &&
      (old.stage === "ready" ||
        (old.stage !== "failed" && Date.now() - old.updatedAt < LEASE_MS))
    )
      return old._id;
    const attempt = (old?.attempt ?? 0) + 1;
    const mixId = old
      ? old._id
      : await ctx.db.insert("mediaMixes", {
          owner: identity.tokenIdentifier,
          assetId,
          key,
          stage: "queued",
          attempt,
          updatedAt: Date.now(),
          words: normalized,
          matches: plan.matches,
          intervals: plan.intervals,
          timings: {},
        });
    if (old)
      await ctx.db.patch(mixId, {
        stage: "queued",
        attempt,
        error: undefined,
        updatedAt: Date.now(),
      });
    await preparationWorkflow.start(
      ctx,
      internal.media.renderWorkflow,
      { mixId, attempt },
      {
        onComplete: internal.media.workflowFinished,
        context: { kind: "mix", id: mixId, attempt },
      },
    );
    return mixId;
  },
});
export const mixProgress = internalMutation({
  args: {
    mixId: v.id("mediaMixes"),
    attempt: v.number(),
    stage: v.union(
      v.literal("rendering"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    fileId: v.optional(v.string()),
    error: v.optional(v.string()),
    timings: v.optional(mediaTimes),
  },
  returns: v.null(),
  handler: async (ctx, { mixId, attempt, timings, fileId, ...fields }) => {
    const stored = fileId
      ? ctx.db.system.normalizeId("_storage", fileId)
      : undefined;
    if (fileId && !stored) throw Error("Invalid storage receipt");
    const row = await ctx.db.get(mixId);
    if (row?.attempt === attempt)
      await ctx.db.patch(mixId, {
        ...fields,
        ...(stored ? { fileId: stored } : {}),
        timings: { ...row.timings, ...timings },
        updatedAt: Date.now(),
      });
    return null;
  },
});
export const render = internalAction({
  args: { mixId: v.id("mediaMixes"), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, { mixId, attempt }) => {
    const begin = Date.now();
    try {
      const mix: Doc<"mediaMixes"> | null = await ctx.runQuery(
        internal.media.mix,
        { mixId },
      );
      if (!mix || mix.attempt !== attempt) return null;
      const asset: Doc<"mediaAssets"> | null = await ctx.runQuery(
        internal.media.asset,
        { assetId: mix.assetId },
      );
      if (!asset?.originalId) throw Error("Original recording is missing.");
      await ctx.runMutation(internal.media.mixProgress, {
        mixId,
        attempt,
        stage: "rendering",
      });
      const voiceUrl = await ctx.storage.getUrl(
        asset.vocalsId ?? asset.originalId,
      );
      const instrumentalUrl = asset.instrumentalId
        ? await ctx.storage.getUrl(asset.instrumentalId)
        : null;
      const result = record(
        await worker(env.MEDIA_RENDER_URL, {
          voiceUrl,
          instrumentalUrl,
          gain: asset.gain ?? 0.98,
          intervals: mix.intervals,
          uploadUrl: await ctx.storage.generateUploadUrl(),
        }),
      );
      if (asset.frames && number(result.frames) !== asset.frames)
        throw Error("Rendered frame count changed.");
      await ctx.runMutation(internal.media.mixProgress, {
        mixId,
        attempt,
        stage: "ready",
        fileId: string(result.fileId),
        timings: {
          mix_s: number(result.mix_s),
          encode_s: number(result.encode_s),
          worker_s: number(result.worker_s),
          render_request_s: (Date.now() - begin) / 1000,
        },
      });
    } catch (e) {
      await ctx.runMutation(internal.media.mixProgress, {
        mixId,
        attempt,
        stage: "failed",
        error: errorMessage(e),
      });
    }
    return null;
  },
});

export const renderWorkflow = preparationWorkflow.define({
  args: { mixId: v.id("mediaMixes"), attempt: v.number() },
  returns: v.null(),
  handler: async (step, args): Promise<null> => {
    await step.runAction(internal.media.render, args, { retry: false });
    return null;
  },
});
export const workflowFinished = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: v.union(
      v.object({ kind: v.literal("success"), returnValue: v.null() }),
      v.object({ kind: v.literal("failed"), error: v.string() }),
      v.object({ kind: v.literal("canceled") }),
    ),
    context: v.union(
      v.object({
        kind: v.literal("asset"),
        id: v.id("mediaAssets"),
        attempt: v.number(),
      }),
      v.object({
        kind: v.literal("mix"),
        id: v.id("mediaMixes"),
        attempt: v.number(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { result, context }) => {
    if (result.kind === "success") return null;
    if (context.kind === "asset") {
      const row = await ctx.db.get(context.id);
      if (row?.attempt === context.attempt && row.stage !== "review")
        await ctx.db.patch(context.id, {
          stage: "failed",
          error: "Preparation stopped. Retry to resume the saved steps.",
          updatedAt: Date.now(),
        });
    } else {
      const row = await ctx.db.get(context.id);
      if (row?.attempt === context.attempt && row.stage !== "ready")
        await ctx.db.patch(context.id, {
          stage: "failed",
          error: "Rendering stopped. Retry this mix.",
          updatedAt: Date.now(),
        });
    }
    return null;
  },
});

export const savePreview = internalMutation({
  args: {
    assetId: v.id("mediaAssets"),
    attempt: v.number(),
    fileId: v.string(),
    sourceHash: v.string(),
    durationMs: v.number(),
    sourceDurationMs: v.number(),
    isPreview: v.boolean(),
    timings: mediaTimes,
  },
  returns: v.boolean(),
  handler: async (ctx, { assetId, attempt, fileId, ...fields }) => {
    const id = ctx.db.system.normalizeId("_storage", fileId);
    if (!id) throw Error("Invalid preview storage receipt");
    const row = await ctx.db.get(assetId);
    if (!row || row.attempt !== attempt) {
      await ctx.storage.delete(id);
      return false;
    }
    await ctx.db.patch(assetId, {
      ...fields,
      originalId: id,
      timings: { ...row.timings, ...fields.timings },
      updatedAt: Date.now(),
    });
    return true;
  },
});
