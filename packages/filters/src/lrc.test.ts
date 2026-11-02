import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseLrc, toLyricSpans } from "./lrc";

describe("parseLrc", () => {
  it("parses the fixture into sorted timed lines", () => {
    const source = readFileSync(
      new URL("./fixtures/demo.lrc", import.meta.url),
      "utf8",
    );
    expect(parseLrc(source)).toEqual([
      { startMs: 5000, text: "First verse line" },
      { startMs: 5000, text: "Same instant, different words" },
      { startMs: 8000, text: "Lyrics with [brackets] inside stay literal" },
      { startMs: 12340, text: "Repeated tag line" },
      { startMs: 20000, text: "" },
      { startMs: 30000, text: "Chorus plays later" },
      { startMs: 45670, text: "Repeated tag line" },
      { startMs: 62000, text: "Whole seconds only" },
    ]);
  });

  it("scales fractional digits to milliseconds", () => {
    expect(parseLrc("[00:01.2]a")).toEqual([{ startMs: 1200, text: "a" }]);
    expect(parseLrc("[00:01.23]a")).toEqual([{ startMs: 1230, text: "a" }]);
    expect(parseLrc("[00:01.234]a")).toEqual([{ startMs: 1234, text: "a" }]);
    expect(parseLrc("[01:02]a")).toEqual([{ startMs: 62000, text: "a" }]);
    expect(parseLrc("[123:45.678]a")).toEqual([
      { startMs: 7425678, text: "a" },
    ]);
  });

  it("rejects malformed timestamps and mixed tag sequences", () => {
    expect(parseLrc("[00:60.00]bad seconds")).toEqual([]);
    expect(parseLrc("[00:99.00]bad seconds")).toEqual([]);
    expect(parseLrc("[-1:00.00]signed")).toEqual([]);
    expect(parseLrc("[+1:00.00]signed")).toEqual([]);
    expect(parseLrc("[00:05.1234]too many digits")).toEqual([]);
    expect(parseLrc("[0:5.1]one-digit seconds")).toEqual([]);
    expect(parseLrc("[00:05.00][bad]mixed")).toEqual([]);
    expect(parseLrc("[bad][00:05.00]mixed")).toEqual([]);
    expect(parseLrc("[00:01][00:60]bad")).toEqual([]);
    expect(parseLrc("[00:01][00:02")).toEqual([]);
    expect(parseLrc("[00:01][")).toEqual([]);
    expect(parseLrc("[99999999999999:00]unsafe")).toEqual([]);
  });

  it("returns an empty list for untimed or metadata-only input", () => {
    expect(parseLrc("")).toEqual([]);
    expect(parseLrc("just some text\nmore text")).toEqual([]);
    expect(
      parseLrc("[ti:Song]\n[ar:Artist]\n[al:Album]\n[by:Me]\n[offset:+250]"),
    ).toEqual([]);
  });

  it("supports BOM and LF, CRLF, and CR line endings", () => {
    const expected = [
      { startMs: 1000, text: "a" },
      { startMs: 2000, text: "b" },
    ];
    expect(parseLrc("\uFEFF[00:01]a\n[00:02]b")).toEqual(expected);
    expect(parseLrc("[00:01]a\r\n[00:02]b")).toEqual(expected);
    expect(parseLrc("[00:01]a\r[00:02]b")).toEqual(expected);
  });

  it("trims whitespace and accepts zero-padded single-digit minutes", () => {
    expect(parseLrc("  [0:00.001]  hello  ")).toEqual([
      { startMs: 1, text: "hello" },
    ]);
  });

  it("expands repeated leading tags and keeps duplicate timestamps stable", () => {
    expect(parseLrc("[00:05][00:10]echo")).toEqual([
      { startMs: 5000, text: "echo" },
      { startMs: 10000, text: "echo" },
    ]);
    expect(parseLrc("[00:05][00:05]echo")).toEqual([
      { startMs: 5000, text: "echo" },
      { startMs: 5000, text: "echo" },
    ]);
    expect(parseLrc("[00:05]first\n[00:05]second")).toEqual([
      { startMs: 5000, text: "first" },
      { startMs: 5000, text: "second" },
    ]);
  });

  it("preserves blank timed cues and brackets inside lyric text", () => {
    expect(parseLrc("[00:20.000]")).toEqual([{ startMs: 20000, text: "" }]);
    expect(parseLrc("[00:08]sing [chorus] now")).toEqual([
      { startMs: 8000, text: "sing [chorus] now" },
    ]);
  });
});
describe("toLyricSpans", () => {
  it("infers ends from the next later cue and shares ends across duplicates", () => {
    const spans = toLyricSpans(
      [
        { startMs: 0, text: "" },
        { startMs: 1000, text: "first" },
        { startMs: 1000, text: "translation" },
        { startMs: 3000, text: "" },
        { startMs: 5000, text: "last" },
        { startMs: 10000, text: "beyond" },
      ],
      8000,
    );
    expect(spans).toEqual([
      { startMs: 0, endMs: 1000, text: "", timing: "line" },
      { startMs: 1000, endMs: 3000, text: "first", timing: "line" },
      { startMs: 1000, endMs: 3000, text: "translation", timing: "line" },
      { startMs: 3000, endMs: 5000, text: "", timing: "line" },
      { startMs: 5000, endMs: 8000, text: "last", timing: "line" },
    ]);
  });
  it("returns an empty list for empty input or invalid duration", () => {
    expect(toLyricSpans([], 8000)).toEqual([]);
    expect(toLyricSpans([{ startMs: 0, text: "a" }], 0)).toEqual([]);
    expect(toLyricSpans([{ startMs: 0, text: "a" }], -5)).toEqual([]);
    expect(toLyricSpans([{ startMs: 0, text: "a" }], 1.5)).toEqual([]);
    expect(
      toLyricSpans([{ startMs: 0, text: "a" }], Number.MAX_SAFE_INTEGER + 1),
    ).toEqual([]);
  });
  it("drops cues at or beyond the duration or out of range", () => {
    expect(
      toLyricSpans(
        [
          { startMs: 8000, text: "exact end" },
          { startMs: 9000, text: "after" },
        ],
        8000,
      ),
    ).toEqual([]);
    expect(
      toLyricSpans(
        [
          { startMs: -1, text: "negative" },
          { startMs: 100, text: "kept" },
        ],
        8000,
      ),
    ).toEqual([{ startMs: 100, endMs: 8000, text: "kept", timing: "line" }]);
  });
  it("sorts a copied array without mutating the input", () => {
    const input = [
      { startMs: 3000, text: "later" },
      { startMs: 1000, text: "earlier" },
    ];
    expect(toLyricSpans(input, 8000)).toEqual([
      { startMs: 1000, endMs: 3000, text: "earlier", timing: "line" },
      { startMs: 3000, endMs: 8000, text: "later", timing: "line" },
    ]);
    expect(input[0].startMs).toBe(3000);
  });
  it("preserves every duplicate cue in one timestamp group", () => {
    const input = [
      { startMs: 5000, text: "a" },
      { startMs: 5000, text: "b" },
      { startMs: 5000, text: "c" },
      { startMs: 5000, text: "d" },
      { startMs: 5000, text: "e" },
      { startMs: 6000, text: "next" },
    ];
    const spans = toLyricSpans(input, 8000);
    expect(spans).toHaveLength(6);
    expect(spans.map((s) => s.text)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "next",
    ]);
    expect(spans.slice(0, 5).every((s) => s.endMs === 6000)).toBe(true);
  });
  it("ends a single cue at the duration", () => {
    expect(toLyricSpans([{ startMs: 500, text: "only" }], 8000)).toEqual([
      { startMs: 500, endMs: 8000, text: "only", timing: "line" },
    ]);
  });
});
