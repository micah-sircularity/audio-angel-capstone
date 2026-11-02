import type { LyricSpan } from "@audio-angel/contracts";

export type LrcLine = {
  readonly startMs: number;
  readonly text: string;
};

const timestampTag = /^\[(\d+):(\d{2})(?:\.(\d{1,3}))?\]/;
const bracketTag = /^\[[^\]]*\]/;

const parseTag = (tag: string): number | null => {
  const match = timestampTag.exec(tag);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isSafeInteger(minutes) || seconds > 59) return null;
  const fraction = match[3] ? Number(match[3].padEnd(3, "0")) : 0;
  const startMs = minutes * 60_000 + seconds * 1_000 + fraction;
  return Number.isSafeInteger(startMs) ? startMs : null;
};

// Parses LRC text into timed lyric lines sorted by startMs. Metadata tags and
// the [offset:] tag are recognized only as non-timestamp tags and are ignored;
// offsets are intentionally unsupported and have no effect on timings.
export function parseLrc(source: string): LrcLine[] {
  const lines: LrcLine[] = [];
  for (const raw of source.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/)) {
    const trimmed = raw.trim();
    if (!trimmed || !trimmed.startsWith("[")) continue;
    const tags: string[] = [];
    let rest = trimmed;
    let malformed = false;
    while (rest.startsWith("[")) {
      const tag = bracketTag.exec(rest);
      if (!tag) {
        malformed = true;
        break;
      }
      tags.push(tag[0]);
      rest = rest.slice(tag[0].length);
    }
    if (malformed) continue;
    const starts = tags.map(parseTag);
    if (starts.some((ms) => ms === null)) continue;
    const text = rest.trim();
    for (const startMs of starts as number[]) lines.push({ startMs, text });
  }
  return lines.sort((a, b) => a.startMs - b.startMs);
}

/**
 * Converts parsed LRC cues into line-timed spans for a known track duration.
 * End times are inferred from the next strictly later cue (or the duration
 * for the last cue); they are not word boundaries. Duplicate timestamps keep
 * source order and share one end. Cues outside [0, durationMs) are dropped.
 */
export function toLyricSpans(
  lines: readonly LrcLine[],
  durationMs: number,
): LyricSpan[] {
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) return [];
  const cues = lines
    .filter(
      (line) =>
        Number.isSafeInteger(line.startMs) &&
        line.startMs >= 0 &&
        line.startMs < durationMs,
    )
    .sort((a, b) => a.startMs - b.startMs);
  const spans: LyricSpan[] = [];
  for (let i = 0; i < cues.length; ) {
    let next = i + 1;
    while (next < cues.length && cues[next].startMs === cues[i].startMs)
      next++;
    const endMs = next < cues.length ? cues[next].startMs : durationMs;
    for (let j = i; j < next; j++)
      spans.push({
        startMs: cues[j].startMs,
        endMs,
        text: cues[j].text,
        timing: "line",
      });
    i = next;
  }
  return spans;
}
