import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";
import {
  Action,
  Capabilities,
  DeviceCapabilities,
  LyricSpan,
  Lyrics,
  PlannedAction,
  Profile,
  Rule,
  TimedLyricLine,
} from "./index";
import {
  defaultProfiles,
  demoCapabilities,
  demoLyrics,
  tracks,
} from "../../../apps/app/src/data/demo";
import { buildPlan } from "../../filters/src/index";

const rule = {
  id: "cuss-words",
  label: "Cuss words",
  kind: "category",
  value: "profanity",
  action: "mute",
  enabled: true,
} as const;
const profile = { id: "kids", name: "With the kids", rules: [rule] };
const line = { startMs: 1000, endMs: 2500, text: "A sample lyric line" };
const capabilities = {
  canMute: false,
  canSeek: true,
  background: "unverified",
} as const;
const action = {
  startMs: 800,
  endMs: 2700,
  action: "skip-section",
  reasons: ["Cuss words"],
} as const;

describe("shared sample contracts", () => {
  it("decodes all five requested shapes from unknown JSON", () => {
    expect(
      Schema.decodeUnknownSync(Rule)(JSON.parse(JSON.stringify(rule))),
    ).toEqual(rule);
    expect(
      Schema.decodeUnknownSync(Profile)(JSON.parse(JSON.stringify(profile))),
    ).toEqual(profile);
    expect(
      Schema.decodeUnknownSync(TimedLyricLine)(
        JSON.parse(JSON.stringify(line)),
      ),
    ).toEqual(line);
    expect(
      Schema.decodeUnknownSync(DeviceCapabilities)(
        JSON.parse(JSON.stringify(capabilities)),
      ),
    ).toEqual(capabilities);
    expect(
      Schema.decodeUnknownSync(PlannedAction)(
        JSON.parse(JSON.stringify(action)),
      ),
    ).toEqual(action);
  });

  it("accepts an empty profile and a silent timed line", () => {
    expect(Schema.is(Profile)({ ...profile, rules: [] })).toBe(true);
    expect(Schema.is(TimedLyricLine)({ ...line, startMs: 0, text: "" })).toBe(
      true,
    );
  });

  it.each(["category", "term", "topic"])("supports %s rules", (kind) => {
    expect(Schema.is(Rule)({ ...rule, kind })).toBe(true);
  });

  it.each(["mute", "skip-section", "skip-song"])(
    "supports the %s action",
    (value) => {
      expect(Schema.is(Action)(value)).toBe(true);
      expect(Schema.is(Rule)({ ...rule, action: value })).toBe(true);
      expect(Schema.is(PlannedAction)({ ...action, action: value })).toBe(true);
    },
  );

  it("validates the app's real demo fixtures and generated plans", () => {
    defaultProfiles.forEach((value) =>
      Schema.decodeUnknownSync(Profile)(value),
    );
    Object.values(demoCapabilities).forEach((value) =>
      Schema.decodeUnknownSync(DeviceCapabilities)(value),
    );
    for (const track of tracks) {
      const lyrics = Schema.decodeUnknownSync(Lyrics)(demoLyrics(track.id));
      for (const value of defaultProfiles) {
        for (const device of Object.values(demoCapabilities)) {
          buildPlan(value, lyrics.spans, device, track.durationMs).forEach(
            (item) => Schema.decodeUnknownSync(PlannedAction)(item),
          );
        }
      }
    }
  });

  it("keeps existing capability and lyric-span consumers compatible", () => {
    expect(Capabilities).toBe(DeviceCapabilities);
    expect(
      Schema.decodeUnknownSync(LyricSpan)({ ...line, timing: "estimated" }),
    ).toEqual({ ...line, timing: "estimated" });
  });
});

describe("invalid rule and profile inputs", () => {
  it.each([
    { ...rule, id: "" },
    { ...rule, label: " \t" },
    { ...rule, value: "" },
    { ...rule, kind: "unknown" },
    { ...rule, action: "pause" },
    { ...rule, enabled: "true" },
    { ...rule, enabled: undefined },
  ])("rejects an invalid rule: %j", (input) => {
    expect(() => Schema.decodeUnknownSync(Rule)(input)).toThrow();
  });

  it.each([
    { ...profile, id: " " },
    { ...profile, name: "" },
    { ...profile, rules: null },
    { ...profile, rules: [{ ...rule, enabled: 1 }] },
    { ...profile, rules: undefined },
  ])("rejects an invalid profile: %j", (input) => {
    expect(() => Schema.decodeUnknownSync(Profile)(input)).toThrow();
  });
});

describe("timestamp boundaries", () => {
  it.each([
    { startMs: -1, endMs: 1000 },
    { startMs: 1.5, endMs: 1000 },
    { startMs: 0, endMs: 1000.5 },
    { startMs: 1000, endMs: 1000 },
    { startMs: 2000, endMs: 1000 },
    { startMs: 0, endMs: Number.POSITIVE_INFINITY },
    { startMs: Number.NaN, endMs: 1000 },
    { startMs: "0", endMs: 1000 },
  ])("rejects invalid ranges in lines, spans and actions: %j", (range) => {
    expect(() =>
      Schema.decodeUnknownSync(TimedLyricLine)({ ...line, ...range }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(LyricSpan)({
        ...line,
        timing: "line",
        ...range,
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(PlannedAction)({ ...action, ...range }),
    ).toThrow();
  });

  it("rejects missing line text and invalid timing provenance", () => {
    expect(Schema.is(TimedLyricLine)({ ...line, text: undefined })).toBe(false);
    expect(Schema.is(LyricSpan)({ ...line, timing: "exact-ish" })).toBe(false);
  });
});

describe("capability and planned-action validation", () => {
  it.each([
    { ...capabilities, canMute: "false" },
    { ...capabilities, canSeek: undefined },
    { ...capabilities, background: true },
    { ...capabilities, background: "likely" },
  ])("rejects invalid capabilities: %j", (input) => {
    expect(() => Schema.decodeUnknownSync(DeviceCapabilities)(input)).toThrow();
  });

  it.each([
    { ...action, action: "jump" },
    { ...action, reasons: [] },
    { ...action, reasons: [" "] },
    { ...action, reasons: [123] },
    { ...action, reasons: undefined },
  ])("rejects an invalid planned action: %j", (input) => {
    expect(() => Schema.decodeUnknownSync(PlannedAction)(input)).toThrow();
  });
});

describe("lyrics lookup contracts", () => {
  const request = {
    trackName: "Song",
    artistName: "Artist",
    albumName: "",
    durationMs: 200000,
  };
  const recording = {
    id: 1,
    trackName: "Song",
    artistName: "Artist",
    albumName: "Album",
    durationMs: 200000,
  };
  const span = { startMs: 0, endMs: 2000, text: "line", timing: "line" };
  it("decodes the request and all response variants", async () => {
    const { LyricsLookupRequest, LyricsLookupResponse } = await import(
      "./index"
    );
    expect(Schema.decodeUnknownSync(LyricsLookupRequest)(request)).toEqual(
      request,
    );
    const synced = {
      source: "lrclib",
      status: "synced",
      recording,
      spans: [span],
    };
    const unsynced = {
      source: "lrclib",
      status: "unsynced",
      recording,
      spans: [],
    };
    const instrumental = {
      source: "lrclib",
      status: "instrumental",
      recording,
      spans: [],
    };
    const notFound = {
      source: "lrclib",
      status: "not-found",
      recording: null,
      spans: [],
    };
    for (const body of [synced, unsynced, instrumental, notFound])
      expect(Schema.decodeUnknownSync(LyricsLookupResponse)(body)).toEqual(
        body,
      );
  });
  it("rejects invalid requests", async () => {
    const { LyricsLookupRequest } = await import("./index");
    for (const bad of [
      { ...request, trackName: "   " },
      { ...request, artistName: "" },
      { ...request, trackName: "x".repeat(301) },
      { ...request, durationMs: 999 },
      { ...request, durationMs: 3_600_001 },
      { ...request, durationMs: 2.5 },
    ])
      expect(() =>
        Schema.decodeUnknownSync(LyricsLookupRequest)(bad),
      ).toThrow();
  });
  it("rejects inconsistent status/span combinations", async () => {
    const { LyricsLookupResponse } = await import("./index");
    for (const bad of [
      { source: "lrclib", status: "synced", recording, spans: [] },
      { source: "lrclib", status: "not-found", recording, spans: [] },
      { source: "lrclib", status: "unsynced", recording, spans: [span] },
      { source: "lrclib", status: "instrumental", recording: null, spans: [] },
      { source: "other", status: "synced", recording, spans: [span] },
      {
        source: "lrclib",
        status: "synced",
        recording,
        spans: [{ ...span, timing: "word" }],
      },
      {
        source: "lrclib",
        status: "synced",
        recording,
        spans: [{ ...span, timing: "estimated" }],
      },
      {
        source: "lrclib",
        status: "synced",
        recording: { ...recording, id: -1 },
        spans: [span],
      },
    ])
      expect(() =>
        Schema.decodeUnknownSync(LyricsLookupResponse)(bad),
      ).toThrow();
  });
});

describe("podcast transcript contracts", () => {
  const request = {
    showName: "Show",
    episodeName: "Episode",
    durationMs: 2_300_000,
  };
  const episode = {
    taddyUuid: "abc",
    name: "Episode",
    showName: "Show",
    durationMs: 2_295_000,
    transcriptOrigin: "publisher",
  };
  const span = { startMs: 0, endMs: 2000, text: "line", timing: "line" };
  it("decodes the request and all response variants", async () => {
    const { PodcastTranscriptRequest, PodcastTranscriptResponse } =
      await import("./index");
    expect(
      Schema.decodeUnknownSync(PodcastTranscriptRequest)(request),
    ).toEqual(request);
    const synced = {
      source: "taddy",
      status: "synced",
      episode,
      durationDeltaMs: 5000,
      spans: [span],
    };
    const noTranscript = {
      source: "taddy",
      status: "no-transcript",
      episode: { ...episode, transcriptOrigin: null },
      durationDeltaMs: 5000,
      spans: [],
    };
    const upgrade = {
      source: "taddy",
      status: "requires-upgrade",
      episode,
      durationDeltaMs: 5000,
      spans: [],
    };
    const notFound = {
      source: "taddy",
      status: "not-found",
      episode: null,
      durationDeltaMs: null,
      spans: [],
    };
    for (const body of [synced, noTranscript, upgrade, notFound])
      expect(
        Schema.decodeUnknownSync(PodcastTranscriptResponse)(body),
      ).toEqual(body);
  });
  it("rejects invalid requests", async () => {
    const { PodcastTranscriptRequest } = await import("./index");
    for (const bad of [
      { ...request, showName: "  " },
      { ...request, episodeName: "" },
      { ...request, showName: "x".repeat(201) },
      { ...request, durationMs: 0 },
      { ...request, durationMs: 21_600_001 },
      { ...request, durationMs: 1.5 },
    ])
      expect(() =>
        Schema.decodeUnknownSync(PodcastTranscriptRequest)(bad),
      ).toThrow();
  });
  it("rejects inconsistent status/episode combinations", async () => {
    const { PodcastTranscriptResponse } = await import("./index");
    for (const bad of [
      {
        source: "taddy",
        status: "synced",
        episode,
        durationDeltaMs: 0,
        spans: [],
      },
      {
        source: "taddy",
        status: "synced",
        episode: { ...episode, transcriptOrigin: null },
        durationDeltaMs: 0,
        spans: [span],
      },
      {
        source: "taddy",
        status: "synced",
        episode,
        durationDeltaMs: 0,
        spans: [{ ...span, timing: "word" }],
      },
      {
        source: "taddy",
        status: "not-found",
        episode,
        durationDeltaMs: null,
        spans: [],
      },
      {
        source: "taddy",
        status: "not-found",
        episode: null,
        durationDeltaMs: 5,
        spans: [],
      },
      {
        source: "taddy",
        status: "no-transcript",
        episode: null,
        durationDeltaMs: null,
        spans: [],
      },
      {
        source: "taddy",
        status: "requires-upgrade",
        episode,
        durationDeltaMs: 0,
        spans: [span],
      },
      {
        source: "lrclib",
        status: "synced",
        episode,
        durationDeltaMs: 0,
        spans: [span],
      },
    ])
      expect(() =>
        Schema.decodeUnknownSync(PodcastTranscriptResponse)(bad),
      ).toThrow();
  });
});
