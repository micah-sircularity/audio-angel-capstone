/**
 * Shared pipeline constants and argument validators. Bump
 * PIPELINE_VERSION whenever transcript/decision shapes change so cached
 * chunks and decisions from older runs are ignored.
 */

import { v } from "convex/values";
import { podcastSourceKey } from "./rss";

export const PIPELINE_VERSION = 1;
/** Transcript segments stored per transcriptChunks document. */
export const SEGMENTS_PER_CHUNK = 40;
/** Concurrent Jev decision requests inside the pipeline action. */
export const DECISION_CONCURRENCY = 8;

export const JOB_STATUSES = [
  "queued",
  "resolving",
  "transcribing",
  "classifying",
  "ready",
  "failed",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const jobStatusValidator = v.union(
  v.literal("queued"),
  v.literal("resolving"),
  v.literal("transcribing"),
  v.literal("classifying"),
  v.literal("ready"),
  v.literal("failed"),
);

/** Statuses where a scheduled/in-flight run already owns the job. */
export const ACTIVE_JOB_STATUSES: ReadonlySet<JobStatus> = new Set([
  "queued",
  "resolving",
  "transcribing",
  "classifying",
]);

/** A pickable audio source: an Audius track or a podcast feed episode. */
export const sourceValidator = v.union(
  v.object({ kind: v.literal("audius"), trackId: v.string() }),
  v.object({
    kind: v.literal("podcast"),
    feedUrl: v.string(),
    guid: v.string(),
  }),
);

export type Source =
  | { kind: "audius"; trackId: string }
  | { kind: "podcast"; feedUrl: string; guid: string };

/** Canonical dedupe key: "aud:<trackId>" or "pod:<sha256(feed|guid)[:32]>". */
export async function sourceKeyFor(source: Source): Promise<string> {
  if (source.kind === "audius") return `aud:${source.trackId}`;
  return await podcastSourceKey(source.feedUrl, source.guid);
}
