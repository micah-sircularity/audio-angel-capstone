import { describe, expect, it } from "vitest";
import type { Profile } from "@audio-angel/contracts";
import {
  buildAudioFlags,
  buildReviewItems,
  flagsToPlan,
  neededQuestionKeys,
  rulesSignature,
  topicQuestionKey,
  WORD_PAD_MS_MUSIC,
  WORD_PAD_MS_SPEECH,
  LINE_PAD_MS,
  type TranscriptSegment,
} from "./audio-plan";

const seg = (
  text: string,
  startMs: number,
  endMs: number,
  words: { text: string; startMs: number; endMs: number }[] = [],
): TranscriptSegment => ({ startMs, endMs, text, words });

const profile = (rules: Profile["rules"]): Profile => ({
  id: "p",
  name: "P",
  rules,
});

const profanityMute = {
  id: "r-prof",
  label: "Profanity",
  kind: "category" as const,
  value: "profanity",
  action: "mute" as const,
  enabled: true,
};

const topicSkip = {
  id: "r-topic",
  label: "Topic",
  kind: "topic" as const,
  value: "spiders",
  action: "skip-section" as const,
  enabled: true,
};

const segments: TranscriptSegment[] = [
  seg("hello there friend", 0, 1000, [
    { text: "hello", startMs: 0, endMs: 300 },
    { text: "there", startMs: 300, endMs: 600 },
    { text: "friend", startMs: 600, endMs: 1000 },
  ]),
  seg("that damn dog", 2000, 3000, [
    { text: "that", startMs: 2000, endMs: 2300 },
    { text: "damn", startMs: 2300, endMs: 2600 },
    { text: "dog", startMs: 2600, endMs: 3000 },
  ]),
];

describe("topicQuestionKey / rulesSignature / neededQuestionKeys", () => {
  it("normalizes topic keys like the backend", () => {
    expect(topicQuestionKey("  many   words ")).toBe("topic:many words");
    expect(topicQuestionKey("x".repeat(120))).toBe(`topic:${"x".repeat(80)}`);
  });

  it("signature covers enabled rules only and is order-insensitive", () => {
    const p = profile([
      profanityMute,
      { ...topicSkip, enabled: false },
      { id: "r2", label: "B", kind: "term", value: "x", action: "skip-section", enabled: true },
    ]);
    expect(rulesSignature(p)).toBe("r-prof:mute|r2:skip-section");
  });

  it("needed keys are known categories plus topic keys", () => {
    const p = profile([
      profanityMute,
      topicSkip,
      { id: "r-x", label: "X", kind: "category", value: "unknown-cat", action: "mute", enabled: true },
      { id: "r-t", label: "T", kind: "term", value: "dang", action: "mute", enabled: true },
    ]);
    expect(neededQuestionKeys(p)).toEqual(["profanity", "topic:spiders"]);
  });
});

describe("buildAudioFlags", () => {
  it("word-list hits produce word-level auto flags", () => {
    const flags = buildAudioFlags(profile([profanityMute]), segments, {}, "speech");
    const hit = flags.find((f) => f.source === "word-list");
    expect(hit).toBeDefined();
    expect(hit!.flagId).toBe("w1:r-prof:1");
    expect(hit!.matchedText).toBe("damn");
    expect(hit!.startMs).toBe(2300 - WORD_PAD_MS_SPEECH);
    expect(hit!.endMs).toBe(2600 + WORD_PAD_MS_SPEECH);
    expect(hit!.tier).toBe("auto");
    expect(hit!.probability).toBeNull();
  });

  it("uses the wider music pad for word mutes", () => {
    const flags = buildAudioFlags(profile([profanityMute]), segments, {}, "music");
    const hit = flags.find((f) => f.source === "word-list")!;
    expect(hit.startMs).toBe(2300 - WORD_PAD_MS_MUSIC);
  });

  it("model probabilities map to auto/review/ignored tiers", () => {
    const flags = buildAudioFlags(
      profile([topicSkip]),
      segments,
      { "topic:spiders": [0.9, 0.5] },
      "speech",
    );
    const model = flags.filter((f) => f.source === "model");
    expect(model).toHaveLength(2);
    expect(model[0]).toMatchObject({
      flagId: "s0:r-topic",
      tier: "auto",
      probability: 0.9,
      startMs: 0,
      endMs: 1000 + LINE_PAD_MS,
    });
    expect(model[1].tier).toBe("review");
  });

  it("marks below-threshold model flags ignored", () => {
    const flags = buildAudioFlags(
      profile([topicSkip]),
      segments,
      { "topic:spiders": [0.1, 0.44] },
      "speech",
    );
    expect(flags.every((f) => f.tier === "ignored")).toBe(true);
  });
});

describe("flagsToPlan", () => {
  const all = (flags: ReturnType<typeof buildAudioFlags>) =>
    flagsToPlan(flags, new Map(), 10_000);

  it("merges model segment flags into padded actions", () => {
    const flags = buildAudioFlags(
      profile([topicSkip]),
      segments,
      { "topic:spiders": [0.95, 0.95] },
      "speech",
    );
    const plan = all(flags);
    // Two skip-section flags 1s apart merge into one 0..3.12s action.
    expect(plan).toHaveLength(1);
    expect(plan[0].action).toBe("skip-section");
    expect(plan[0].endMs).toBe(3120);
    expect(plan[0].reasons).toEqual(["Topic"]);
  });

  it("drops flags the reviewer unchecked, keeps others", () => {
    const flags = buildAudioFlags(
      profile([topicSkip]),
      segments,
      { "topic:spiders": [0.9, 0.9] },
      "speech",
    );
    const plan = flagsToPlan(
      flags,
      new Map([["s1:r-topic", false]]),
      10_000,
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].startMs).toBe(0);
    expect(plan[0].endMs).toBe(1120);
  });

  it("mixed mute + skip-section merges into a skip-section", () => {
    // A mute 700ms after a skip-section is absorbed into the skip.
    const flags = [
      ...buildAudioFlags(profile([profanityMute]), segments, {}, "speech"),
      ...buildAudioFlags(
        profile([topicSkip]),
        segments,
        { "topic:spiders": [0.9, 0.9] },
        "speech",
      ),
    ];
    const plan = flagsToPlan(flags, new Map(), 10_000);
    expect(plan).toHaveLength(1);
    expect(plan[0].action).toBe("skip-section");
    expect(plan[0].endMs).toBe(3120);
    expect(plan[0].reasons).toEqual(["Topic", "Profanity"]);
  });

  it("keeps distant mute and skip-section actions separate", () => {
    const spaced: TranscriptSegment[] = [
      segments[0],
      seg("a damn shame", 4000, 5000, [
        { text: "a", startMs: 4000, endMs: 4200 },
        { text: "damn", startMs: 4300, endMs: 4600 },
        { text: "shame", startMs: 4600, endMs: 5000 },
      ]),
    ];
    const flags = [
      ...buildAudioFlags(profile([profanityMute]), spaced, {}, "speech"),
      ...buildAudioFlags(
        profile([topicSkip]),
        spaced,
        { "topic:spiders": [0.9, 0] },
        "speech",
      ),
    ];
    const plan = flagsToPlan(flags, new Map(), 10_000);
    // skip-section [0,1120] then word mute [4220,4680]: gap > 1.5s.
    expect(plan).toHaveLength(2);
    expect(plan[0].action).toBe("skip-section");
    expect(plan[1].action).toBe("mute");
  });

  it("skip-song wins over everything", () => {
    const p = profile([
      { ...topicSkip, action: "skip-song" as const },
    ]);
    const flags = buildAudioFlags(
      p,
      segments,
      { "topic:spiders": [0.99, 0] },
      "speech",
    );
    const plan = flagsToPlan(flags, new Map(), 10_000);
    expect(plan).toEqual([
      { startMs: 0, endMs: 10_000, action: "skip-song", reasons: ["Topic"] },
    ]);
  });

  it("ignores 'ignored' tier flags entirely", () => {
    const flags = buildAudioFlags(
      profile([topicSkip]),
      segments,
      { "topic:spiders": [0.1, 0.1] },
      "speech",
    );
    expect(flagsToPlan(flags, new Map(), 10_000)).toEqual([]);
  });
});

describe("buildReviewItems", () => {
  it("returns non-ignored flags sorted by time", () => {
    const flags = buildAudioFlags(
      profile([topicSkip]),
      segments,
      { "topic:spiders": [0.5, 0.1] },
      "speech",
    );
    const items = buildReviewItems(flags);
    expect(items).toHaveLength(1);
    expect(items[0].flagId).toBe("s0:r-topic");
  });
});
