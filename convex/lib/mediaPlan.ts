export const MEDIA_VERSION = 1;
export const DEFAULT_BLOCKED_WORDS = [
  "fuck",
  "fucking",
  "fucked",
  "motherfucker",
  "shit",
  "bullshit",
  "bitch",
  "bitches",
  "asshole",
  "dick",
  "pussy",
  "damn",
  "bastard",
  "nigga",
  "niggas",
  "nigger",
  "niggers",
];
export const normalizeWord = (word: string) =>
  word
    .toLowerCase()
    .replaceAll("’", "'")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
export function planWords(
  words: readonly { text: string; startMs: number; endMs: number }[],
  blocked: readonly string[],
  durationMs: number,
) {
  const selected = new Set(blocked.map(normalizeWord));
  const matches = words.filter((w) => selected.has(normalizeWord(w.text)));
  const intervals: { start: number; end: number }[] = [];
  for (const word of [...matches].sort((a, b) => a.startMs - b.startMs)) {
    const start = Math.max(0, word.startMs - 40) / 1000;
    const end = Math.min(durationMs, word.endMs + 70) / 1000;
    const last = intervals.at(-1);
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else if (end > start) intervals.push({ start, end });
  }
  return { matches, intervals };
}
