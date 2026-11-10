import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { Schema } from "effect";
import { serveAudio } from "./static-audio";

const Word = Schema.Struct({ word: Schema.String, start: Schema.Number, end: Schema.Number, confidence: Schema.Number });
const Manifest = Schema.Struct({
  title: Schema.String, artist: Schema.String, sourceUrl: Schema.String,
  duration: Schema.Number, frames: Schema.Number, sampleRate: Schema.Number, gain: Schema.Number,
  fingerprints: Schema.Struct({ vocals: Schema.String, instrumental: Schema.String }),
  words: Schema.Array(Word), defaultWords: Schema.Array(Schema.String),
  vocalsPath: Schema.String, instrumentalPath: Schema.String,
  transcription: Schema.Struct({ transcription_s: Schema.Number, preparation_s: Schema.Number, runs: Schema.Number }),
  priorSeparation: Schema.Struct({ first_separation_s: Schema.Number, repeat_separations: Schema.Struct({ median_s: Schema.Number }) }),
});
const Request = Schema.Struct({ words: Schema.Array(Schema.String) });
const Report = Schema.Struct({
  key: Schema.String, blockedWords: Schema.Array(Schema.String),
  matches: Schema.Array(Word), intervals: Schema.Array(Schema.Struct({ start: Schema.Number, end: Schema.Number })),
  timings: Schema.Struct({ planning_s: Schema.Number, mix_s: Schema.Number, encode_s: Schema.Number, validation_s: Schema.Number, render_total_s: Schema.Number }),
});
type ManifestValue = typeof Manifest.Type;
type ReportValue = typeof Report.Type;
const REVISION = "vocal-gate-v1-pad40-70-fade10-mp3-192k";
const seconds = (start: number) => (performance.now() - start) / 1000;
export function normalizeWord(word: string) {
  return word.toLowerCase().replaceAll("’", "'").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

export function wordIntervals(manifest: Pick<ManifestValue, "words" | "duration">, blockedWords: readonly string[]) {
  const wanted = new Set(blockedWords);
  const matches = manifest.words.filter((word) => wanted.has(normalizeWord(word.word)));
  const intervals: { start: number; end: number }[] = [];
  for (const word of [...matches].sort((a, b) => a.start - b.start)) {
    const start = Math.max(0, word.start - .04);
    const end = Math.min(manifest.duration, word.end + .07);
    const previous = intervals.at(-1);
    if (previous && start <= previous.end) previous.end = Math.max(previous.end, end);
    else intervals.push({ start, end });
  }
  return { matches, intervals };
}

export function vocalGate(intervals: readonly { start: number; end: number }[]) {
  return intervals.map(({ start, end }) => {
    const fade = Math.min(.01, (end - start) / 2);
    const s = start.toFixed(6), e = end.toFixed(6), f = fade.toFixed(6);
    return `if(between(t,${s},${e}),min(1,max(0,(${s}+${f}-t)/${f}))+min(1,max(0,(t-(${e}-${f}))/${f})),1)`;
  }).join("*") || "1";
}

async function command(binary: string, args: string[]) {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });
    let output = "", error = "";
    child.stdout.on("data", (chunk: Buffer) => { output = (output + chunk.toString()).slice(-4096); });
    child.stderr.on("data", (chunk: Buffer) => { error = (error + chunk.toString()).slice(-4096); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output) : reject(new Error(`${binary} failed (${code}): ${error}`)));
  });
}

export class RapWordTest {
  private manifest: Promise<ManifestValue> | undefined;
  private active: { key: string; result: Promise<ReportValue> } | undefined;
  constructor(private readonly directory: string | undefined) {}

  private getManifest() {
    if (!this.directory) throw new Error("Rap experiment is not configured");
    this.manifest ??= readFile(join(this.directory, "manifest.json"), "utf8")
      .then((text) => Schema.decodeUnknownSync(Manifest)(JSON.parse(text)));
    return this.manifest;
  }

  private async render(manifest: ManifestValue, words: string[], key: string, directory: string): Promise<ReportValue> {
    const started = performance.now();
    const { matches, intervals } = wordIntervals(manifest, words);
    const gate = vocalGate(intervals);
    const planning_s = seconds(started);
    const temporary = join(directory, `${key}-${randomUUID()}`);
    const wav = temporary + ".wav", mp3 = temporary + ".mp3";
    try {
      let t = performance.now();
      await command("ffmpeg", ["-nostdin", "-v", "error", "-y", "-i", manifest.instrumentalPath, "-i", manifest.vocalsPath,
        "-filter_complex", `[1:a]aeval=exprs='val(0)*(${gate})|val(1)*(${gate})':channel_layout=stereo[v];[0:a][v]amix=inputs=2:normalize=0:duration=first,volume=${manifest.gain}[out]`,
        "-map", "[out]", "-c:a", "pcm_f32le", wav]);
      const mix_s = seconds(t);
      t = performance.now();
      await command("ffmpeg", ["-nostdin", "-v", "error", "-y", "-i", wav, "-c:a", "libmp3lame", "-b:a", "192k", mp3]);
      const encode_s = seconds(t);
      t = performance.now();
      const probe: unknown = JSON.parse(await command("ffprobe", ["-v", "error", "-show_entries", "format=duration,size", "-of", "json", mp3]));
      const checked = Schema.decodeUnknownSync(Schema.Struct({ format: Schema.Struct({ duration: Schema.String, size: Schema.String }) }))(probe);
      if (Math.abs(Number(checked.format.duration) - manifest.duration) > .1 || Number(checked.format.size) < 1000) throw new Error("Rendered audio failed duration/size validation");
      const validation_s = seconds(t);
      const report = { key, blockedWords: words, matches, intervals,
        timings: { planning_s, mix_s, encode_s, validation_s, render_total_s: seconds(started) } };
      await rename(mp3, join(directory, key + ".mp3"));
      await writeFile(temporary + ".json", JSON.stringify(report));
      await rename(temporary + ".json", join(directory, key + ".json"));
      return report;
    } finally {
      await Promise.all([wav, mp3, temporary + ".json"].map((file) => rm(file, { force: true })));
    }
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (!pathname.startsWith("/api/rap-test")) return false;
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(body));
    };
    if (!this.directory) { send(404, { error: "Rap experiment is not enabled on this server." }); return true; }
    try {
      const manifest = await this.getManifest();
      const directory = join(this.directory, "mixes");
      if (pathname === "/api/rap-test" && req.method === "GET") {
        send(200, { title: manifest.title, artist: manifest.artist, duration: manifest.duration,
          sourceUrl: manifest.sourceUrl, words: manifest.words, defaultWords: manifest.defaultWords,
          gain: manifest.gain, transcription: manifest.transcription, priorSeparation: manifest.priorSeparation,
          padding: { beforeMs: 40, afterMs: 70, fadeMs: 10 }, revision: REVISION });
        return true;
      }
      const audio = /^\/api\/rap-test\/audio\/([a-f0-9]{64})\.mp3$/.exec(pathname);
      if (audio && (req.method === "GET" || req.method === "HEAD")) {
        const file = join(directory, audio[1] + ".mp3");
        try { serveAudio(req, res, file, (await stat(file)).size); }
        catch { send(404, { error: "This mix has not been rendered." }); }
        return true;
      }
      if (pathname !== "/api/rap-test/render" || req.method !== "POST") {
        send(405, { error: "Use GET for the experiment or POST /api/rap-test/render." }); return true;
      }
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) { send(403, { error: "Use the listening page on this server." }); return true; }
      if (!req.headers["content-type"]?.startsWith("application/json")) { send(415, { error: "Send application/json." }); return true; }
      let text = "";
      for await (const chunk of req) {
        text += chunk.toString();
        if (Buffer.byteLength(text) > 4096) { send(413, { error: "Word list is too large." }); return true; }
      }
      let submitted: typeof Request.Type;
      try { submitted = Schema.decodeUnknownSync(Request)(JSON.parse(text)); }
      catch { send(400, { error: "Provide a words array." }); return true; }
      if (submitted.words.length > 100 || submitted.words.some((w) => !/^[\p{L}\p{N}'’ -]{1,40}$/u.test(w))) {
        send(400, { error: "Use at most 100 individual words, each 1–40 characters." }); return true;
      }
      const words = [...new Set(submitted.words.map(normalizeWord).filter(Boolean))].sort();
      const started = performance.now();
      const key = createHash("sha256").update(JSON.stringify({ revision: REVISION, stems: manifest.fingerprints,
        transcript: manifest.words, duration: manifest.duration, gain: manifest.gain, words })).digest("hex");
      await mkdir(directory, { recursive: true });
      const respond = (report: ReportValue, cache: "hit" | "miss" | "shared") => send(200, {
        ...report, cache, audioUrl: `/api/rap-test/audio/${key}.mp3`, request_s: seconds(started),
        current_work: cache === "miss" ? report.timings : null,
      });
      try {
        const report = Schema.decodeUnknownSync(Report)(JSON.parse(await readFile(join(directory, key + ".json"), "utf8")));
        await stat(join(directory, key + ".mp3"));
        respond(report, "hit"); return true;
      } catch { /* No complete cached artifact. Render below. */ }
      const cachedFiles = await readdir(directory);
      // Check after disk I/O, then claim the worker without another await.
      if (this.active) {
        if (this.active.key === key) respond(await this.active.result, "shared");
        else send(503, { error: "Another mix is rendering. Try again in a moment." });
        return true;
      }
      if (cachedFiles.filter((file) => file.endsWith(".json")).length >= 64) {
        send(429, { error: "This experiment's 64-mix cache is full." }); return true;
      }
      const result = this.render(manifest, words, key, directory);
      this.active = { key, result };
      try { respond(await result, "miss"); } finally { this.active = undefined; }
    } catch (error) {
      console.error("Rap test failed", error instanceof Error ? error.message : "Unknown error");
      if (!res.headersSent) send(500, { error: "The rap experiment could not complete. Check the server logs." });
    }
    return true;
  }
}
