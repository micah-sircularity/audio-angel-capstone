/** Real FFmpeg renders, each followed by its own cached request. No GPU/API calls. */
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { RapWordTest } from "../../apps/server/src/rap-test";

const directory = resolve(process.argv[2] ?? "tools/spleeter/output/rap-word-filter");
const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
const samples = [];
for (let run = 0; run < 5; run++) {
  const temp = await mkdtemp(join(tmpdir(), "rap-render-benchmark-"));
  await writeFile(join(temp, "manifest.json"), JSON.stringify(manifest));
  const app = new RapWordTest(temp);
  const server = createServer((req, res) => { void app.handle(req, res); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No benchmark port");
  const url = `http://127.0.0.1:${address.port}/api/rap-test/render`;
  try {
    const pair = [];
    for (const expected of ["miss", "hit"]) {
      const start = performance.now();
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ words: manifest.defaultWords }) });
      const report = await response.json();
      const client_s = (performance.now() - start) / 1000;
      if (response.status !== 200 || report.cache !== expected || report.matches.length !== 5) throw new Error("Benchmark did not perform expected work");
      pair.push({ ...report, client_s });
    }
    samples.push({ run: run + 1, miss: pair[0], hit: pair[1] });
    console.log(JSON.stringify({ run: run + 1, miss_s: pair[0].client_s, hit_s: pair[1].client_s, timings: pair[0].timings }));
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(temp, { recursive: true, force: true });
  }
}
const stats = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return { median: sorted[2], min: sorted[0], max: sorted[4], samples: values }; };
const report = { duration_s: manifest.duration, runs: 5, failures: 0, input: "cached float32 WAV stems", output: "192kbps MP3",
  notes: ["Five fresh output caches; file/OS caches may be warm.", "Each miss is immediately followed by its matching cache hit.", "Loopback HTTP includes request and JSON response, not downloading the final MP3 or starting browser playback.", "CPU render on project host; no separation or transcription inside these timings."],
  transcription: manifest.transcription,
  summary: { miss_s: stats(samples.map((s) => s.miss.client_s)), hit_s: stats(samples.map((s) => s.hit.client_s)),
    mix_s: stats(samples.map((s) => s.miss.timings.mix_s)), encode_s: stats(samples.map((s) => s.miss.timings.encode_s)) }, samples };
await writeFile(join(directory, "benchmark.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report.summary));
