import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { mediaStage, mediaWord, mediaTimes } from './lib/mediaValidators';
// Better Auth's component owns accounts, encrypted OAuth tokens and sessions.
// Spotify library content is fetched on demand, never copied into this database.

const jobStatus = v.union(
  v.literal("queued"),
  v.literal("resolving"),
  v.literal("transcribing"),
  v.literal("classifying"),
  v.literal("ready"),
  v.literal("failed"),
);

const transcriptSegment = v.object({
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
});

export default defineSchema({
  mediaAssets: defineTable({
    startedAt: v.optional(v.number()),
    isPreview: v.optional(v.boolean()),
    sourceDurationMs: v.optional(v.number()),
    owner: v.string(), sourceKey: v.string(), kind: v.union(v.literal('music'),v.literal('podcast')),
    version: v.number(), stage: mediaStage, attempt: v.number(), updatedAt: v.number(),
    title: v.optional(v.string()), error: v.optional(v.string()),
    originalId: v.optional(v.id('_storage')), sourceHash: v.optional(v.string()),
    vocalsId: v.optional(v.id('_storage')), instrumentalId: v.optional(v.id('_storage')),
    durationMs: v.optional(v.number()), frames: v.optional(v.number()), gain: v.optional(v.number()),
    words: v.optional(v.array(mediaWord)), timings: mediaTimes,
  }).index('by_owner_and_sourceKey_and_version',['owner','sourceKey','version']),
  mediaMixes: defineTable({
    owner: v.string(), assetId: v.id('mediaAssets'), key: v.string(),
    stage: v.union(v.literal('queued'),v.literal('rendering'),v.literal('ready'),v.literal('failed')),
    attempt: v.number(), updatedAt: v.number(), words: v.array(v.string()),
    matches: v.array(mediaWord), intervals: v.array(v.object({start:v.number(),end:v.number()})),
    fileId: v.optional(v.id('_storage')), error: v.optional(v.string()), timings: mediaTimes,
  }).index('by_owner_and_key',['owner','key']),
  // A resolved external audio item (Audius track or podcast episode),
  // deduplicated by its canonical sourceKey.
  audioSources: defineTable({
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
  }).index("by_sourceKey", ["sourceKey"]),

  // One row per (sourceKey, pipelineVersion) tracking the async pipeline;
  // progress fields feed the realtime "Listening…" UI.
  processingJobs: defineTable({
    sourceKey: v.string(),
    pipelineVersion: v.number(),
    status: jobStatus,
    progressDone: v.optional(v.number()),
    progressTotal: v.optional(v.number()),
    error: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_sourceKey_and_pipelineVersion", [
    "sourceKey",
    "pipelineVersion",
  ]),

  // Deepgram transcript segments, bucketed SEGMENTS_PER_CHUNK at a time so
  // long episodes stay under document size limits.
  transcriptChunks: defineTable({
    sourceKey: v.string(),
    pipelineVersion: v.number(),
    chunkIndex: v.number(),
    segments: v.array(transcriptSegment),
  }).index("by_sourceKey_and_pipelineVersion", [
    "sourceKey",
    "pipelineVersion",
  ]),

  // Jev noul probabilities, one row per (questionKey, chunkIndex); probs
  // aligns 1:1 with the chunk's segments for realtime partial results.
  chunkDecisions: defineTable({
    sourceKey: v.string(),
    pipelineVersion: v.number(),
    questionKey: v.string(),
    chunkIndex: v.number(),
    probs: v.array(v.number()),
  }).index("by_sourceKey_and_pipelineVersion_and_questionKey", [
    "sourceKey",
    "pipelineVersion",
    "questionKey",
  ]),
});
