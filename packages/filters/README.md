# @audio-angel/filters

Pure, dependency-free lyric filtering and timing helpers.

## API

- `matchesTerm(text, term)` - whole-word term matching with plural variants.
- `buildPlan(profile, spans, capabilities, durationMs)` - turns filter rules and timed lyric spans into a merged mute/skip plan.
- `parseLrc(source)` - parses LRC text into `LrcLine[]` (`{ startMs, text }`), sorted ascending by `startMs` with stable ordering for equal timestamps.

## LRC parsing notes

- Supports `[m:ss]`, `[mm:ss.f]`, `[mm:ss.ff]`, `[mm:ss.fff]`; fractions scale by decimal place to integer milliseconds.
- Consecutive leading timestamp tags expand into one entry per tag with the same text; lines whose leading tag run contains any non-timestamp tag are skipped entirely.
- Metadata tags (`[ti:]`, `[ar:]`, `[al:]`, `[by:]`, `[offset:]`), untimed text, and malformed timestamps are ignored.
- The `[offset:]` tag is unsupported: it is parsed as metadata and has no effect on timestamps.
- Duplicate timestamps are preserved; no end times or durations are inferred.
