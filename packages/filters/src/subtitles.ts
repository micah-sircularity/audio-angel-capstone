import type { LyricSpan } from "@audio-angel/contracts";

// Subtitle formats from podcast transcript publishers. Cues become line-timed
// spans; ends come from the file (unlike LRC inference). Cues with invalid or
// non-positive ranges and empty text are dropped.

type Cue = { startMs: number; endMs: number; text: string };

const toSpans = (cues: Cue[]): LyricSpan[] =>
  cues
    .filter(
      (cue) =>
        Number.isSafeInteger(cue.startMs) &&
        Number.isSafeInteger(cue.endMs) &&
        cue.startMs >= 0 &&
        cue.endMs > cue.startMs &&
        cue.text.trim().length > 0,
    )
    .sort((a, b) => a.startMs - b.startMs)
    .map((cue) => ({ ...cue, text: cue.text.trim(), timing: "line" }));

const stripTags = (text: string) =>
  text
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

const parseTime = (
  value: string,
  separator: "," | ".",
): number | null => {
  const match = new RegExp(
    `^(?:(\\d+):)?([0-9]{1,2}):([0-9]{2})\\${separator}(\\d{1,3})$`,
  ).exec(value.trim());
  if (!match) return null;
  const hours = match[1] === undefined ? 0 : Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fraction = Number(match[4].padEnd(3, "0"));
  if (!Number.isSafeInteger(hours) || minutes > 59 || seconds > 59) return null;
  const ms = hours * 3_600_000 + minutes * 60_000 + seconds * 1_000 + fraction;
  return Number.isSafeInteger(ms) ? ms : null;
};

const timingLine = (separator: "," | ".") =>
  new RegExp(
    `^\\s*(?:(?:\\d+:)?[0-9]{1,2}:[0-9]{2}\\${separator}\\d{1,3})\\s*-->\\s*(?:(?:\\d+:)?[0-9]{1,2}:[0-9]{2}\\${separator}\\d{1,3})`,
  );

/** Parses SubRip text. The cue index line is optional in the wild. */
export function parseSrt(source: string): LyricSpan[] {
  const blocks = source
    .replace(/^\uFEFF/, "")
    .split(/\r\n|\r|\n/)
    .join("\n")
    .split(/\n\s*\n/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.trim().length > 0);
    if (!lines.length) continue;
    const timingIndex = lines.findIndex((line) =>
      timingLine(",").test(line),
    );
    if (timingIndex < 0) continue;
    const [startRaw, endRaw] = lines[timingIndex].split("-->");
    const startMs = parseTime(startRaw ?? "", ",");
    const endMs = parseTime((endRaw ?? "").trim().split(/\s/)[0] ?? "", ",");
    if (startMs === null || endMs === null) continue;
    const text = stripTags(lines.slice(timingIndex + 1).join(" "));
    cues.push({ startMs, endMs, text });
  }
  return toSpans(cues);
}

/** Parses WebVTT text. NOTE/STYLE/REGION blocks and cue tags are stripped. */
export function parseVtt(source: string): LyricSpan[] {
  const lines = source.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
  const timing = timingLine(".");
  const cues: Cue[] = [];
  let i = 0;
  // Header may carry metadata on the WEBVTT line itself.
  if (lines[0]?.trimStart().startsWith("WEBVTT")) i = 1;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      i++;
      continue;
    }
    if (/^(NOTE|STYLE|REGION)\b/.test(trimmed)) {
      i++;
      while (i < lines.length && lines[i].trim()) i++;
      continue;
    }
    let cueLine = trimmed;
    if (!timing.test(cueLine) && i + 1 < lines.length) {
      // Optional cue identifier line.
      if (timing.test(lines[i + 1].trim())) {
        i++;
        cueLine = lines[i].trim();
      } else {
        i++;
        continue;
      }
    }
    const [startRaw, endAndSettings] = cueLine.split("-->");
    const startMs = parseTime(startRaw ?? "", ".");
    const endMs = parseTime((endAndSettings ?? "").trim().split(/\s/)[0] ?? "", ".");
    i++;
    const text: string[] = [];
    while (i < lines.length && lines[i].trim()) {
      text.push(lines[i].trim());
      i++;
    }
    if (startMs === null || endMs === null) continue;
    cues.push({ startMs, endMs, text: stripTags(text.join(" ")) });
  }
  return toSpans(cues);
}

/**
 * Parses Podcasting 2.0 JSON transcripts:
 * { segments: [{ startTime, endTime, body, speaker? }] } with times in seconds.
 */
export function parsePodcastJson(source: string): LyricSpan[] {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return [];
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const segments = (raw as Record<string, unknown>).segments;
  if (!Array.isArray(segments)) return [];
  const cues: Cue[] = [];
  for (const segment of segments) {
    if (!segment || typeof segment !== "object") continue;
    const record = segment as Record<string, unknown>;
    if (
      typeof record.startTime !== "number" ||
      typeof record.endTime !== "number" ||
      !Number.isFinite(record.startTime) ||
      !Number.isFinite(record.endTime) ||
      typeof record.body !== "string"
    )
      continue;
    const speaker =
      typeof record.speaker === "string" && record.speaker.trim()
        ? `${record.speaker.trim()}: `
        : "";
    cues.push({
      startMs: Math.round(record.startTime * 1000),
      endMs: Math.round(record.endTime * 1000),
      text: speaker + record.body,
    });
  }
  return toSpans(cues);
}
