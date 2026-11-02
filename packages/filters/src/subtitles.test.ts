import { describe, expect, it } from "vitest";
import { parsePodcastJson, parseSrt, parseVtt } from "./subtitles";

describe("parseSrt", () => {
  it("parses numbered cues with comma milliseconds", () => {
    const srt =
      "1\n00:00:06,180 --> 00:00:09,480\nKyrin Down: Welcome, everyone to another\nepisode of the value for value.\n\n2\n00:00:09,480 --> 00:00:12,000\nSecond line\n";
    expect(parseSrt(srt)).toEqual([
      {
        startMs: 6180,
        endMs: 9480,
        text: "Kyrin Down: Welcome, everyone to another episode of the value for value.",
        timing: "line",
      },
      { startMs: 9480, endMs: 12000, text: "Second line", timing: "line" },
    ]);
  });
  it("accepts buzzsprout-style leading spaces before the index", () => {
    const srt =
      "  1\n00:00:01,000 --> 00:00:02,500\nHello\n\n  2\n00:00:02,500 --> 00:00:04,000\nWorld\n";
    expect(parseSrt(srt).map((span) => span.text)).toEqual([
      "Hello",
      "World",
    ]);
  });
  it("accepts cues without an index line and sorts by start", () => {
    const srt =
      "00:00:05,000 --> 00:00:06,000\nLater\n\n00:00:01,000 --> 00:00:02,000\nFirst\n";
    const spans = parseSrt(srt);
    expect(spans[0]).toMatchObject({ startMs: 1000, text: "First" });
    expect(spans[1]).toMatchObject({ startMs: 5000, text: "Later" });
  });
  it("skips malformed cues and empty text", () => {
    const srt =
      "garbage\n\n1\n00:00:01,000 --> 00:00:02,000\n   \n\n2\nnot a time --> x\ntext\n\n3\n00:00:03,000 --> 00:00:01,000\nbackwards\n";
    expect(parseSrt(srt)).toEqual([]);
  });
  it("handles CRLF and BOM", () => {
    const srt = "\uFEFF1\r\n00:00:01,000 --> 00:00:02,000\r\nHi\r\n";
    expect(parseSrt(srt)).toHaveLength(1);
  });
  it("returns [] for empty input", () => {
    expect(parseSrt("")).toEqual([]);
  });
});

describe("parseVtt", () => {
  it("parses cues and skips NOTE blocks", () => {
    const vtt =
      "WEBVTT\n\nNOTE this is a comment\nspanning lines\n\n00:00:06.180 --> 00:00:09.480\nHello there\n\n00:00:09.480 --> 00:00:11.000\nNext\n";
    const spans = parseVtt(vtt);
    expect(spans).toHaveLength(2);
    expect(spans[0]).toMatchObject({ startMs: 6180, endMs: 9480 });
  });
  it("accepts hour-less timestamps and strips voice/tags", () => {
    const vtt =
      "WEBVTT\n\n00:06.180 --> 00:09.480\n<v Kyrin>Welcome <c>friends</c> <00:00:07.000>now</v>\n";
    const spans = parseVtt(vtt);
    expect(spans).toEqual([
      {
        startMs: 6180,
        endMs: 9480,
        text: "Welcome friends now",
        timing: "line",
      },
    ]);
  });
  it("parses hours and skips STYLE blocks", () => {
    const vtt =
      "WEBVTT\n\nSTYLE\n::cue { color: lime }\n\n1:00:01.000 --> 1:00:02.000\nHour two\n";
    expect(parseVtt(vtt)).toEqual([
      { startMs: 3601000, endMs: 3602000, text: "Hour two", timing: "line" },
    ]);
  });
  it("handles cue identifiers and multi-line text", () => {
    const vtt =
      "WEBVTT\n\ncue-1\n00:01.000 --> 00:02.000\nline one\nline two\n";
    expect(parseVtt(vtt)[0]).toMatchObject({
      startMs: 1000,
      text: "line one line two",
    });
  });
  it("drops zero/negative duration cues and malformed blocks", () => {
    const vtt =
      "WEBVTT\n\n00:02.000 --> 00:01.000\nbad\n\n00:03.000 --> 00:04.000\ngood\n";
    const spans = parseVtt(vtt);
    expect(spans).toHaveLength(1);
    expect(spans[0].text).toBe("good");
  });
  it("returns [] for empty input", () => {
    expect(parseVtt("")).toEqual([]);
  });
});

describe("parsePodcastJson", () => {
  it("parses segments with seconds and speakers", () => {
    const json = JSON.stringify({
      segments: [
        { startTime: 1.5, endTime: 3, body: "hello", speaker: "Adam" },
        { startTime: 3, endTime: 4.25, body: "world" },
        { startTime: 9, endTime: 8, body: "bad" },
        { startTime: 5, endTime: 6, body: "   " },
      ],
    });
    expect(parsePodcastJson(json)).toEqual([
      { startMs: 1500, endMs: 3000, text: "Adam: hello", timing: "line" },
      { startMs: 3000, endMs: 4250, text: "world", timing: "line" },
    ]);
  });
  it("returns [] for malformed or unrelated JSON", () => {
    expect(parsePodcastJson("not json")).toEqual([]);
    expect(parsePodcastJson("null")).toEqual([]);
    expect(parsePodcastJson("[]")).toEqual([]);
    expect(parsePodcastJson("{}")).toEqual([]);
    expect(parsePodcastJson('{"segments":"nope"}')).toEqual([]);
  });
});
