import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RapWordTest, wordIntervals } from "./rap-test";

describe("rap word test", () => {
  let folder: string, base: string, server: Server;
  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), "audio-angel-word-test-"));
    const beat = join(folder, "beat.wav"), vocals = join(folder, "vocals.wav");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "aevalsrc=0.2*sin(2*PI*220*t)|0:s=44100:d=1", "-c:a", "pcm_f32le", beat]);
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "aevalsrc=0|0.2*sin(2*PI*440*t):s=44100:d=1", "-c:a", "pcm_f32le", vocals]);
    await writeFile(join(folder, "manifest.json"), JSON.stringify({ title: "Synthetic", artist: "Test", sourceUrl: "https://example.com", duration: 1, frames: 44100, sampleRate: 44100, gain: 1,
      fingerprints: { vocals: "voice-fixture", instrumental: "beat-fixture" }, words: [{ word: "test", start: .3, end: .6, confidence: 1 }], defaultWords: ["test"],
      vocalsPath: vocals, instrumentalPath: beat, transcription: { transcription_s: 1, preparation_s: .1, runs: 1 }, priorSeparation: { first_separation_s: 2, repeat_separations: { median_s: 1 } } }));
    const test = new RapWordTest(folder);
    server = createServer((req, res) => { void test.handle(req, res); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test port");
    base = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(folder, { recursive: true, force: true });
  });

  it("merges overlapping padded word intervals and matches complete normalized words", () => {
    const result = wordIntervals({ duration: 2, words: [
      { word: "Test!", start: .1, end: .3, confidence: 1 },
      { word: "test", start: .32, end: .6, confidence: 1 },
      { word: "testing", start: 1, end: 1.5, confidence: 1 },
    ] }, ["test"]);
    expect(result.matches).toHaveLength(2);
    expect(result.intervals).toHaveLength(1);
    expect(result.intervals[0].start).toBeCloseTo(.06);
    expect(result.intervals[0].end).toBeCloseTo(.67);
  });

  it("renders real audio with only the vocal channel muted, then reuses the cached MP3", async () => {
    const render = async (words: string[]) => {
      const response = await fetch(base + "/api/rap-test/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ words }) });
      expect(response.status).toBe(200);
      return await response.json();
    };
    const unmuted = await render([]), edited = await render(["TEST"]), cached = await render(["test", "test"]);
    expect(edited.cache).toBe("miss");
    expect(edited.matches).toHaveLength(1);
    expect(cached.cache).toBe("hit");
    expect(cached.audioUrl).toBe(edited.audioUrl);
    expect(cached.current_work).toBeNull();
    const decode = async (url: string) => {
      const filename = url.split("/").at(-1);
      if (!filename) throw new Error("Missing audio filename");
      const bytes = execFileSync("ffmpeg", ["-v", "error", "-i", join(folder, "mixes", filename), "-f", "f32le", "-ac", "2", "pipe:1"]);
      return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    };
    const a = await decode(unmuted.audioUrl), b = await decode(edited.audioUrl);
    expect(a.length).toBe(88200);
    expect(b.length).toBe(a.length);
    const rms = (data: Float32Array, channel: number) => {
      let sum = 0, count = 0;
      for (let frame = 17640; frame < 22050; frame++) { sum += data[frame * 2 + channel] ** 2; count++; }
      return Math.sqrt(sum / count);
    };
    expect(rms(b, 1)).toBeLessThan(.002);
    expect(rms(a, 1)).toBeGreaterThan(.1);
    expect(rms(b, 0)).toBeCloseTo(rms(a, 0), 2);
    expect((await readFile(join(folder, "mixes", edited.key + ".mp3"))).length).toBeGreaterThan(1000);
    const range = await fetch(base + edited.audioUrl, { headers: { Range: "bytes=0-1" } });
    expect(range.status).toBe(206);
    expect((await range.arrayBuffer()).byteLength).toBe(2);
  });

  it("rejects invalid inputs and cross-origin render requests", async () => {
    const invalid = await fetch(base + "/api/rap-test/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ words: ["x;[0:a]"] }) });
    expect(invalid.status).toBe(400);
    const crossOrigin = await fetch(base + "/api/rap-test/render", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://another.example" }, body: '{"words":[]}' });
    expect(crossOrigin.status).toBe(403);
    const bad = await fetch(base + "/api/rap-test/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
    expect(bad.status).toBe(400);
  });

  it("shares a render between simultaneous identical requests", async () => {
    const request = () => fetch(base + "/api/rap-test/render", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ words: ["test", "parallel"] }),
    }).then(async (response) => {
      expect(response.status).toBe(200);
      return await response.json();
    });
    const reports = await Promise.all([request(), request()]);
    expect(reports[0].key).toBe(reports[1].key);
    expect(reports.map((report) => report.cache).sort()).toEqual(["miss", "shared"]);
  });
});
