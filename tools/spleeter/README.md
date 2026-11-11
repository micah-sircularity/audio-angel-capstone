# Spleeter on one Modal T4

This isolated experiment measures Spleeter separation on one T4 and saves audio for listening. It does not deploy an API or change the app/Convex backend.

## Run

Install no global dependencies; use the existing `uv` tool:

```bash
uvx --from 'modal==1.6.3' modal token new
uvx --from 'modal==1.6.3' modal run tools/spleeter/modal_test.py
```

The default input is Spleeter's official `audio_example.mp3` demo. See its [credits and license](https://github.com/deezer/spleeter#credits). To test your own file:

```bash
uvx --from 'modal==1.6.3' modal run tools/spleeter/modal_test.py \
  --file /absolute/path/song.mp3 --seconds 60 --repeats 5 \
  --mute-start 12 --mute-end 12.5
```

Audio is uploaded to the Modal worker. The test uses a CUDA 11.8/cuDNN 8 container with Python 3.10, Spleeter 2.4.2 and TensorFlow 2.12.1. Weights are fetched while building the image, so a first inference does not silently include the model download. One worker, one T4, no automatic retries; it scales down after a short idle window. No persistent audio volume is created. Normal provider execution/data-retention terms still apply.

Input is capped at 25 MiB; the test decodes the first 30 seconds by default (maximum requested length 120 seconds). A source shorter than the requested length is reported at its actual decoded duration. The preview interval must fit that actual duration.

Each timestamped output folder contains:

- `original.wav`: the exact decoded/resampled clip used as model input.
- `instrumental.wav` and `vocals.wav`: same-frame-count Spleeter outputs.
- `manual-window-preview.wav`: the original outside the chosen interval and its own instrumental inside, with 10 ms fades inside the interval. This interval is manual, not a detected word.
- `report.json`: first separation, five repeat samples, median/range, real-time factor, sampled device VRAM/utilization, decoding/export times and local remote-call wall time.

The local remote-call timing includes request/upload/queue/worker/download overhead after Modal has built and started the app; it is not a full fresh-image build benchmark. Repeat timings use the public Spleeter API, which can perform per-call graph/session setup. Sampled reserved GPU memory is not the model's minimum VRAM requirement. All outputs are checked for finite values and identical shapes; listening and acoustic alignment tests remain necessary.

The test intentionally fails if CUDA/TensorFlow cannot see exactly one GPU. It does not silently fall back to a CPU benchmark. No run is labeled a success when validation fails.

## Local check without GPU access

```bash
uv run --with 'modal==1.6.3' --with 'numpy==2.2.6' \
  python tools/spleeter/modal_test.py --self-test
```

This checks preview continuity, interval validation and preservation outside the edit window. It does not install Spleeter locally, call Modal or measure real separation.

## Listen inside the web app

The app's Listen screen has a **Try the vocal muting listening test** button. The same-origin `/spleeter-test.html` page defaults to the full 78.81-second rap recording “I Be On My Shit” by Smiz The Cryptokid, with a manual instrumental substitution at 20–22 seconds and a button to start at 0:15. The earlier 120-second acoustic test remains selectable, with its 30–30.5s edit. Both tracks offer the original, edited mix, full instrumental, and isolated vocals. Playback position is preserved when switching versions; choosing another track resets the position. This page uses prepared outputs; it does not invoke Modal or detect words.

The fixtures live in `apps/app/public/spleeter-test/` and are copied into the Expo web export. The app server serves MP3 MIME types and single byte ranges for playback/seeking, including HEAD requests and 416 responses for invalid ranges. These audio files are not added to the PWA offline shell cache.

## Automatic word muting: Cryptokid track

Open `/rap-words.html` from the separation test page. This single-track experiment uses the saved 78.81-second Spleeter outputs; it does not rerun the GPU model.

Prepare the server cache from the existing WAV stems:

```bash
uv run --with numpy --with soundfile python tools/spleeter/prepare_rap.py
```

The script reads the Deepgram credential from the process environment or the existing personal development Convex deployment without printing it. On a transcript cache miss it uploads a mono PCM16 WAV made directly from the aligned vocal stem. It retains the uncensored word timestamps and confidence scores in the ignored output directory. It computes a fixed headroom gain from the stem peaks, shared by filtered and unfiltered reconstructed mixes. Transcription is keyed by the actual input audio hash. The source paths in this experiment are explicitly fixed in the preparation script.

Set `RAP_TEST_CACHE_DIR` to the absolute path of `tools/spleeter/output/rap-word-filter`, then start the app server. FFmpeg and ffprobe must be installed. The API stays disabled when the setting is absent. No credentials are sent to the browser, no new Convex functions are deployed, and the Modal worker is not kept running.

The page offers the initial profanity list, custom single words, and a vocabulary picker. Rendering matches complete normalized words, pads intervals by 40 ms before and 70 ms after, merges overlaps, applies 10 ms fades to vocal gain, then mixes the unchanged instrumental and edited vocals. The shared fixed headroom gain is applied to both tracks. It encodes one 192 kbps MP3. The unmuted reconstruction gives a fair comparison using the same stems and gain; the original recording and isolated stems remain available. Replay buttons seek to two seconds before each matched occurrence; another button rewinds three seconds.

Finished mixes are keyed by stem fingerprints, transcript/timestamps, normalized word list, duration, headroom gain, and processing version. Temporary files are removed and completed files are published through rename. Identical concurrent requests share work; a different render returns busy while one is running. The cache is limited to 64 mixes. Audio supports HEAD and byte ranges. This is an opt-in experiment on the project server, not a production multi-user storage/CDN integration.

Measured times distinguish current render work from historical cached artifacts. `current_work` is null on cache hits. Transcription timing includes upload/provider/response, not credential lookup or prior separation. CPU rendering records edit planning, mix, encoding, output validation, server processing, and browser request latency. Page preparation also accounts for creating the unmuted comparison when needed. Browser audio startup is not included.

Repeat the CPU benchmark without making API/GPU calls:

```bash
pnpm --filter @audio-angel/server exec tsx ../../tools/spleeter/benchmark_words.mts \
  /absolute/path/to/tools/spleeter/output/rap-word-filter
```

It runs five full renders into fresh output caches, each followed by its cache hit. It checks successful responses, expected matches, and cache status; the renderer validates MP3 duration and size. Results are saved as `benchmark.json`. OS/file caches can be warm. Loopback timings do not measure Internet audio delivery. The automated synthetic-audio test separately verifies vocal muting, instrumental preservation, output length, cache reuse, malformed input rejection and byte-range serving. Recognition quality and vocal leakage still need listening review.

## Longer podcast previews

The reusable Convex media pipeline sends podcast intake to the authenticated Modal CPU `preview` endpoint. It accepts source episodes up to 512 MiB on worker disk, follows up to 12 validated HTTPS redirects, and saves a 96 kbps MP3 of the first 30 minutes (or the complete shorter episode). Convex stores that clip as the canonical unfiltered recording. Transcription timestamps are bounded to its duration, and filtering/playback reuse the same clip. Music retains its existing duration and input-size limits. `MEDIA_PREVIEW_URL` is a Convex deployment setting.

CPU-only worker regressions:

```bash
uv run --with "modal==1.6.3" --with "fastapi[standard]" --with "requests==2.32.5" --with "numpy==2.2.6" python tools/spleeter/test_pipeline_worker.py
```
