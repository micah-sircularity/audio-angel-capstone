import type {
  Profile,
  Track,
  Lyrics,
  Capabilities,
} from "@audio-angel/contracts";
export const tracks: Track[] = [
  {
    id: "further",
    title: "A little further",
    artist: "Northbound",
    album: "Open country",
    durationMs: 212000,
    artwork: "country",
  },
  {
    id: "blue",
    title: "Blue hour",
    artist: "The Lanterns",
    album: "After the rain",
    durationMs: 248000,
    artwork: "blue",
  },
  {
    id: "morning",
    title: "Stay awhile",
    artist: "June & the Pines",
    album: "Slow mornings",
    durationMs: 194000,
    artwork: "morning",
  },
];
export const playlists = [
  {
    id: "drive",
    name: "Weekend drive",
    count: 24,
    artwork: "country" as const,
    trackIds: ["further", "blue"],
  },
  {
    id: "morning",
    name: "Slow mornings",
    count: 18,
    artwork: "morning" as const,
    trackIds: ["morning", "further"],
  },
  {
    id: "repeat",
    name: "On repeat",
    count: 32,
    artwork: "blue" as const,
    trackIds: ["blue", "morning"],
  },
];
export const defaultProfiles: Profile[] = [
  {
    id: "kids",
    name: "With the kids",
    rules: [
      {
        id: "profanity",
        label: "Cuss words",
        kind: "category",
        value: "profanity",
        action: "mute",
        enabled: true,
      },
      {
        id: "slurs",
        label: "Slurs",
        kind: "category",
        value: "slurs",
        action: "mute",
        enabled: true,
      },
      {
        id: "sexual",
        label: "Sexual content",
        kind: "category",
        value: "sexual",
        action: "skip-song",
        enabled: true,
      },
      {
        id: "drugs",
        label: "Drug references",
        kind: "category",
        value: "drugs",
        action: "skip-section",
        enabled: true,
      },
      {
        id: "violence",
        label: "Graphic violence",
        kind: "category",
        value: "violence",
        action: "skip-section",
        enabled: false,
      },
      {
        id: "blasphemy",
        label: "Blasphemy",
        kind: "category",
        value: "blasphemy",
        action: "mute",
        enabled: false,
      },
    ],
  },
  {
    id: "wife",
    name: "With my wife",
    rules: [
      {
        id: "slurs",
        label: "Slurs",
        kind: "category",
        value: "slurs",
        action: "mute",
        enabled: true,
      },
      {
        id: "profanity",
        label: "Cuss words",
        kind: "category",
        value: "profanity",
        action: "mute",
        enabled: false,
      },
      {
        id: "violence",
        label: "Graphic violence",
        kind: "category",
        value: "violence",
        action: "skip-section",
        enabled: true,
      },
    ],
  },
];
export const demoCapabilities: Record<string, Capabilities> = {
  iPhone: { canMute: false, canSeek: true, background: "unverified" },
  Android: { canMute: true, canSeek: true, background: "unverified" },
  Desktop: { canMute: true, canSeek: true, background: "unverified" },
};
export const demoLyrics = (id: string): Lyrics => ({
  source: "demo",
  recordingId: id,
  spans: [
    { startMs: 102000, endMs: 104000, text: "damn", timing: "estimated" },
    { startMs: 156000, endMs: 160000, text: "hell", timing: "estimated" },
  ],
});
export const time = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
