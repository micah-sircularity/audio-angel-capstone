/**
 * Audio-native lane planner: turns Deepgram transcript segments + cached
 * Jev model probabilities into reviewable flags and, after approvals,
 * into the same PlannedAction list the filter scheduler already runs.
 *
 * Pure, client-shareable logic — imports only contracts types and the
 * matcher's word-list helpers from this package.
 */

import type {
  Action,
  PlannedAction,
  Profile,
  Rule,
} from "@audio-angel/contracts";
import {
  categoryKeys,
  categoryTerms,
  matchesTerm,
  normalize,
} from "./index";

export type WordSpan = {
  startMs: number;
  endMs: number;
  text: string;
};

export type TranscriptSegment = {
  startMs: number;
  endMs: number;
  text: string;
  words: WordSpan[];
};

export type FlagTier = "auto" | "review" | "ignored";

export type AudioFlag = {
  flagId: string;
  ruleId: string;
  ruleLabel: string;
  action: Action;
  startMs: number;
  endMs: number;
  /** The exact matched words (word-list) or the segment text (model). */
  matchedText: string;
  segmentText: string;
  tier: FlagTier;
  /** Model probability 0..1, or null for word-list hits. */
  probability: number | null;
  source: "word-list" | "model";
};

/** Model probabilities at/above AUTO are applied without review. */
export const MODEL_AUTO_THRESHOLD = 0.8;
/** Probabilities in [REVIEW, AUTO) need a human check first. */
export const MODEL_REVIEW_THRESHOLD = 0.45;
/** Word timing is exact for speech; sung vocals get a wider pad. */
export const WORD_PAD_MS_SPEECH = 80;
export const WORD_PAD_MS_MUSIC = 150;
/** Model flags cover a whole segment plus a small pad. */
export const LINE_PAD_MS = 120;
/** Mutes this close together merge into one continuous dip. */
const MUTE_MERGE_GAP_MS = 150;
/** Seeks this close together merge into one continuous skip. */
const SECTION_MERGE_GAP_MS = 1500;

/** Normalizes a user topic and returns its decisions-cache key. */
export function topicQuestionKey(topic: string): string {
  const normalized = topic.trim().replace(/\s+/g, " ").slice(0, 80);
  return `topic:${normalized}`;
}

/**
 * Stable fingerprint of a profile's enabled rules; a cached plan is
 * reusable when the signature is unchanged.
 */
export function rulesSignature(profile: Profile): string {
  return profile.rules
    .filter((rule) => rule.enabled)
    .map((rule) => `${rule.id}:${rule.action}`)
    .sort()
    .join("|");
}

/**
 * Question keys the model must answer for this profile: one per enabled
 * known category plus one `topic:` key per enabled topic rule. Unknown
 * category values and term rules (handled by the word list) are ignored.
 */
export function neededQuestionKeys(profile: Profile): string[] {
  const known = new Set(categoryKeys());
  const keys = new Set<string>();
  for (const rule of profile.rules) {
    if (!rule.enabled) continue;
    if (rule.kind === "category" && known.has(rule.value)) {
      keys.add(rule.value);
    } else if (rule.kind === "topic") {
      keys.add(topicQuestionKey(rule.value));
    }
  }
  return [...keys];
}

const termTokenCount = (term: string): number =>
  (normalize(term).match(/[\p{L}\p{N}]+/gu) ?? []).length;

function wordListFlags(
  profile: Profile,
  segments: readonly TranscriptSegment[],
  padMs: number,
): AudioFlag[] {
  const flags: AudioFlag[] = [];
  for (const rule of profile.rules) {
    if (!rule.enabled) continue;
    const terms =
      rule.kind === "term"
        ? [rule.value]
        : rule.kind === "category"
          ? [...categoryTerms(rule.value)]
          : [];
    for (const term of terms) {
      const count = termTokenCount(term);
      if (!count) continue;
      for (let s = 0; s < segments.length; s++) {
        const words = segments[s].words;
        for (let w = 0; w + count <= words.length; w++) {
          const slice = words.slice(w, w + count);
          const matchedText = slice.map((word) => word.text).join(" ");
          if (!matchesTerm(matchedText, term)) continue;
          flags.push({
            flagId: `w${s}:${rule.id}:${w}`,
            ruleId: rule.id,
            ruleLabel: rule.label,
            action: rule.action,
            startMs: Math.max(0, slice[0].startMs - padMs),
            endMs: slice[count - 1].endMs + padMs,
            matchedText,
            segmentText: segments[s].text,
            tier: "auto",
            probability: null,
            source: "word-list",
          });
        }
      }
    }
  }
  return flags;
}

function modelQuestionKey(rule: Rule): string | null {
  if (rule.kind === "category" && categoryKeys().includes(rule.value)) {
    return rule.value;
  }
  if (rule.kind === "topic") return topicQuestionKey(rule.value);
  return null;
}

function modelFlags(
  profile: Profile,
  segments: readonly TranscriptSegment[],
  decisions: Record<string, number[]>,
): AudioFlag[] {
  const flags: AudioFlag[] = [];
  for (const rule of profile.rules) {
    if (!rule.enabled) continue;
    const key = modelQuestionKey(rule);
    if (!key) continue;
    const probs = decisions[key];
    if (!probs) continue;
    for (let s = 0; s < segments.length && s < probs.length; s++) {
      const probability = probs[s];
      if (typeof probability !== "number" || !Number.isFinite(probability)) {
        continue;
      }
      const tier: FlagTier =
        probability >= MODEL_AUTO_THRESHOLD
          ? "auto"
          : probability >= MODEL_REVIEW_THRESHOLD
            ? "review"
            : "ignored";
      const segment = segments[s];
      flags.push({
        flagId: `s${s}:${rule.id}`,
        ruleId: rule.id,
        ruleLabel: rule.label,
        action: rule.action,
        startMs: Math.max(0, segment.startMs - LINE_PAD_MS),
        endMs: segment.endMs + LINE_PAD_MS,
        matchedText: segment.text,
        segmentText: segment.text,
        tier,
        probability,
        source: "model",
      });
    }
  }
  return flags;
}

/**
 * Builds every flag a profile raises over a transcript: exact word-list
 * hits plus model flags tiered by probability. `decisions` maps a
 * question key to per-segment probabilities (global segment order).
 */
export function buildAudioFlags(
  profile: Profile,
  segments: readonly TranscriptSegment[],
  decisions: Record<string, number[]>,
  kind: "music" | "speech",
): AudioFlag[] {
  const wordPad =
    kind === "music" ? WORD_PAD_MS_MUSIC : WORD_PAD_MS_SPEECH;
  return [
    ...wordListFlags(profile, segments, wordPad),
    ...modelFlags(profile, segments, decisions),
  ];
}

/**
 * Applies review approvals and merges the surviving flags into timed
 * PlannedActions. Approvals map flagId -> keep; "auto" and "review"
 * default to kept, "ignored" is always dropped. skip-song wins outright.
 */
export function flagsToPlan(
  flags: readonly AudioFlag[],
  approvals: ReadonlyMap<string, boolean>,
  durationMs: number,
): PlannedAction[] {
  const kept = flags.filter((flag) => {
    if (flag.tier === "ignored") return false;
    return approvals.get(flag.flagId) !== false;
  });
  if (kept.some((flag) => flag.action === "skip-song")) {
    return [
      {
        startMs: 0,
        endMs: durationMs,
        action: "skip-song",
        reasons: [...new Set(kept.map((flag) => flag.ruleLabel))],
      },
    ];
  }
  const raw: PlannedAction[] = kept.map((flag) => ({
    startMs: Math.max(0, flag.startMs),
    endMs: Math.min(durationMs, flag.endMs),
    action: flag.action,
    reasons: [flag.ruleLabel],
  }));
  const merged: PlannedAction[] = [];
  for (const item of raw.sort((a, b) => a.startMs - b.startMs)) {
    const last = merged.at(-1);
    if (!last) {
      merged.push(item);
      continue;
    }
    const gap = item.startMs - last.endMs;
    const involvesSkip =
      last.action === "skip-section" || item.action === "skip-section";
    const threshold = involvesSkip ? SECTION_MERGE_GAP_MS : MUTE_MERGE_GAP_MS;
    if (gap <= threshold) {
      merged[merged.length - 1] = {
        startMs: last.startMs,
        endMs: Math.max(last.endMs, item.endMs),
        action: involvesSkip ? "skip-section" : "mute",
        reasons: [...new Set([...last.reasons, ...item.reasons])],
      };
    } else {
      merged.push(item);
    }
  }
  return merged;
}

/** Flags worth showing in the review UI, earliest first. */
export function buildReviewItems(
  flags: readonly AudioFlag[],
): AudioFlag[] {
  return [...flags]
    .filter((flag) => flag.tier !== "ignored")
    .sort((a, b) => a.startMs - b.startMs);
}
