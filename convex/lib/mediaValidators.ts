import { v } from "convex/values";
export const mediaStage = v.union(
  v.literal("queued"),
  v.literal("resolving"),
  v.literal("downloading"),
  v.literal("separating"),
  v.literal("transcribing"),
  v.literal("review"),
  v.literal("failed"),
);
export const mediaWord = v.object({
  text: v.string(),
  startMs: v.number(),
  endMs: v.number(),
});
export const mediaTimes = v.record(v.string(), v.number());
