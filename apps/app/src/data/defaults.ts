import type { Profile } from "@audio-angel/contracts";
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
export const time = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
