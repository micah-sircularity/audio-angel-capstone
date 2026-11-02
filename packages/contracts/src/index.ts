import * as Schema from "effect/Schema";

const NonBlankString = Schema.String.pipe(
  Schema.pattern(/\S/, { message: () => "Expected a non-blank string" }),
);
const timedTextFields = {
  startMs: Schema.NonNegativeInt,
  endMs: Schema.NonNegativeInt,
  text: Schema.String,
};
const hasPositiveDuration = (range: {
  readonly startMs: number;
  readonly endMs: number;
}) => range.endMs > range.startMs;
const durationError = { message: () => "endMs must be greater than startMs" };

export const Action = Schema.Literal("mute", "skip-section", "skip-song");
export type Action = typeof Action.Type;
export const Rule = Schema.Struct({
  id: NonBlankString,
  label: NonBlankString,
  kind: Schema.Literal("category", "term", "topic"),
  value: NonBlankString,
  action: Action,
  enabled: Schema.Boolean,
});
export type Rule = typeof Rule.Type;
export const Profile = Schema.Struct({
  id: NonBlankString,
  name: NonBlankString,
  rules: Schema.Array(Rule),
});
export type Profile = typeof Profile.Type;
export const ProfileStore = Schema.Struct({
  profiles: Schema.Array(Profile),
  activeId: Schema.String,
});
// Provider-supplied line timing. Blank text is valid for instrumental gaps.
export const TimedLyricLine = Schema.Struct(timedTextFields).pipe(
  Schema.filter(hasPositiveDuration, durationError),
);
export type TimedLyricLine = typeof TimedLyricLine.Type;

// Existing span contract also records whether timing is supplied or estimated.
export const LyricSpan = Schema.Struct({
  ...timedTextFields,
  timing: Schema.Literal("word", "line", "estimated"),
}).pipe(Schema.filter(hasPositiveDuration, durationError));
export type LyricSpan = typeof LyricSpan.Type;
export const Lyrics = Schema.Struct({
  source: Schema.Literal("demo", "lrclib", "musixmatch"),
  recordingId: Schema.String,
  spans: Schema.Array(LyricSpan),
});
export type Lyrics = typeof Lyrics.Type;
export const DeviceCapabilities = Schema.Struct({
  canMute: Schema.Boolean,
  canSeek: Schema.Boolean,
  background: Schema.Literal("unverified", "unsupported", "verified"),
});
export type DeviceCapabilities = typeof DeviceCapabilities.Type;
// Backwards-compatible name used by the player and filter planner.
export const Capabilities = DeviceCapabilities;
export type Capabilities = DeviceCapabilities;
export const PlannedAction = Schema.Struct({
  startMs: Schema.NonNegativeInt,
  endMs: Schema.NonNegativeInt,
  action: Action,
  reasons: Schema.Array(NonBlankString).pipe(Schema.minItems(1)),
}).pipe(Schema.filter(hasPositiveDuration, durationError));
export type PlannedAction = typeof PlannedAction.Type;
export const Track = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  artist: Schema.String,
  album: Schema.String,
  durationMs: Schema.Int.pipe(Schema.positive()),
  artwork: Schema.Literal("country", "blue", "morning"),
});
export type Track = typeof Track.Type;
export type PlaybackState = {
  track: Track;
  positionMs: number;
  playing: boolean;
};
export type PlaybackEvent = {
  id: string;
  at: number;
  kind: "mute" | "seek" | "skip" | "profile";
  description: string;
  reason: string;
  simulated: boolean;
};
export interface PlayerAdapter {
  readonly mode: "demo" | "spotify";
  getState(): PlaybackState;
  subscribe(listener: (state: PlaybackState) => void): () => void;
  play(track?: Track): Promise<void>;
  pause(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  setVolume(volume: number): Promise<void>;
  dispose(): void;
}
export interface LyricsProvider {
  getLyrics(track: Track): Promise<Lyrics | null>;
}
export interface ProfileRepository {
  load(): Promise<typeof ProfileStore.Type | null>;
  save(store: typeof ProfileStore.Type): Promise<void>;
}
// Server-side lyrics lookup: track identity only, never tokens or audio.
export const LyricsLookupRequest = Schema.Struct({
  trackName: NonBlankString.pipe(Schema.maxLength(300)),
  artistName: NonBlankString.pipe(Schema.maxLength(300)),
  albumName: Schema.String.pipe(Schema.maxLength(300)),
  durationMs: Schema.Int.pipe(Schema.between(1000, 3_600_000)),
});
export type LyricsLookupRequest = typeof LyricsLookupRequest.Type;
export const LyricsRecording = Schema.Struct({
  id: Schema.Int.pipe(Schema.nonNegative()),
  trackName: Schema.String,
  artistName: Schema.String,
  albumName: Schema.String,
  durationMs: Schema.Int.pipe(Schema.positive()),
});
export type LyricsRecording = typeof LyricsRecording.Type;
// Lookup spans are always line-timed; word/estimated timings are rejected.
const LineTimedSpan = Schema.Struct({
  ...timedTextFields,
  timing: Schema.Literal("line"),
}).pipe(Schema.filter(hasPositiveDuration, durationError));
const emptySpans = Schema.Array(LineTimedSpan).pipe(Schema.itemsCount(0));
export const LyricsLookupResponse = Schema.Union(
  Schema.Struct({
    source: Schema.Literal("lrclib"),
    status: Schema.Literal("synced"),
    recording: LyricsRecording,
    spans: Schema.NonEmptyArray(LineTimedSpan),
  }),
  Schema.Struct({
    source: Schema.Literal("lrclib"),
    status: Schema.Literal("unsynced", "instrumental"),
    recording: LyricsRecording,
    spans: emptySpans,
  }),
  Schema.Struct({
    source: Schema.Literal("lrclib"),
    status: Schema.Literal("not-found"),
    recording: Schema.Null,
    spans: emptySpans,
  }),
);
export type LyricsLookupResponse = typeof LyricsLookupResponse.Type;
// Podcast transcript lookup through Taddy; episodes are display-only.
export const PodcastTranscriptRequest = Schema.Struct({
  showName: NonBlankString.pipe(Schema.maxLength(200)),
  episodeName: NonBlankString.pipe(Schema.maxLength(200)),
  durationMs: Schema.Int.pipe(Schema.between(1000, 21_600_000)),
});
export type PodcastTranscriptRequest =
  typeof PodcastTranscriptRequest.Type;
const PodcastEpisodeBase = {
  taddyUuid: Schema.String,
  name: Schema.String,
  showName: Schema.String,
  durationMs: Schema.Int.pipe(Schema.positive()),
};
const deltaField = Schema.NullOr(Schema.Int);
const podcastSpans = Schema.Array(LineTimedSpan);
export const PodcastTranscriptResponse = Schema.Union(
  Schema.Struct({
    source: Schema.Literal("taddy"),
    status: Schema.Literal("synced"),
    episode: Schema.Struct({
      ...PodcastEpisodeBase,
      transcriptOrigin: Schema.Literal("publisher", "taddy"),
    }),
    durationDeltaMs: deltaField,
    spans: Schema.NonEmptyArray(LineTimedSpan),
  }),
  Schema.Struct({
    source: Schema.Literal("taddy"),
    status: Schema.Literal("no-transcript", "requires-upgrade"),
    episode: Schema.Struct({
      ...PodcastEpisodeBase,
      transcriptOrigin: Schema.NullOr(
        Schema.Literal("publisher", "taddy"),
      ),
    }),
    durationDeltaMs: deltaField,
    spans: podcastSpans.pipe(Schema.itemsCount(0)),
  }),
  Schema.Struct({
    source: Schema.Literal("taddy"),
    status: Schema.Literal("not-found"),
    episode: Schema.Null,
    durationDeltaMs: Schema.Null,
    spans: podcastSpans.pipe(Schema.itemsCount(0)),
  }),
);
export type PodcastTranscriptResponse =
  typeof PodcastTranscriptResponse.Type;
export const HealthResponse = Schema.Struct({
  status: Schema.Literal("ok"),
  service: Schema.Literal("audio-angel"),
  mode: Schema.Literal("scaffold"),
});
export const ApiError = Schema.Struct({
  error: Schema.Struct({ code: Schema.String, message: Schema.String }),
});
