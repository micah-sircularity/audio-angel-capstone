# Audio Angel

Expo PWA scaffold for a Spotify-controlled music player with listening profiles. **The landing player uses fictional tracks and simulated filtering. Library reads your signed-in Spotify account.** A separate `/spotify` pilot can stream one real track in the browser via the Spotify Web Playback SDK (Premium required); it prefers a matching non-explicit version and supports opt-in estimated word muting or lyric-line skipping.

## Run

Node 22+ and pnpm 11.10.0 (via Corepack):

```sh
corepack enable
pnpm install
pnpm dev
```

Web: http://localhost:8081. Server: http://localhost:3101/health.

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

The production server at http://localhost:3101 serves the exported PWA, route fallbacks and `/health`. The PWA cache is enabled only in production on HTTPS or localhost. Build again after changes. Spotify audio is never available offline.

## Remote preview

This workspace uses Tailscale for viewing from another machine. The current preview is [Audio Angel](https://your-machine.your-tailnet.ts.net:8450/) (tailnet access required).

```sh
HOST=127.0.0.1 PORT=3101 pnpm start
tailscale serve --bg --https=8450 http://127.0.0.1:3101
```

Keep the server running. Inspect `tailscale serve status` before changing routes; other apps already use several ports. Stop only this proxy with `tailscale serve --https=8450 off`.

## Workspace

- `apps/app`: Expo Router application shared by web and future native builds; Now Playing, Library, Profiles, Activity and Settings.
- `apps/server`: Effect configuration, request effects, health check and static serving. `/api/*` explicitly returns 501 until providers are implemented.
- `packages/contracts`: Effect schemas and player, lyrics and profile repository interfaces.
- `packages/filters`: pure term matching and action planning with unit tests.

The UI depends on `PlayerAdapter`; `DemoPlayer` simulates state and commands. There is no audio engine in our app. Profiles use an async repository backed by device-local storage (AsyncStorage/localStorage on web). The demo planner evaluates only a small vocabulary; unimplemented categories and topics are labeled. Activity is session-only and always marked simulated.

## Try the UI

Play a demo track, use Preview to approach a flagged span, and inspect Activity. Switch between iPhone (seek fallback), Android and Desktop in Settings. Edit rule actions, add a term or profile, then reload to check local persistence. Switch light/dark themes. Library requires Spotify sign-in and its Find field searches the current page of real saved content.

## Deployment

The checked-in Dockerfile and railway.json deploy one Railway service containing the static Expo export and Effect backend. Railway supplies `PORT`; the image sets `STATIC_DIR` to the bundled web assets. No live deployment has been made. `.env.example` documents the public Convex URLs for `apps/app/.env.local`. Deploy the Convex functions separately; Expo build-time URLs must point to that deployment. Spotify credentials and the Better Auth secret are backend-only Convex environment variables.

## First live filtering test

1. Open `/search` (or Library → Search all Spotify).
2. Find **Creep by Radiohead** and select the original **Pablo Honey** album recording, not a live version or cover.
3. Press **Play selection**. Once lyrics load, enable **Filter this song** and choose a profile with **Cuss words** enabled (the default **With the kids** profile).
4. Check the planned actions, then press **Preview next filter** to start three seconds before a matching line.

**Prefer clean versions** is on by default in the song picker. Before playback, the app checks the selected track and searches up to 10 catalog results for a non-explicit recording with the same artist IDs, normalized title and a duration within 2% (at most 5 seconds). Live/remix/cover variants are rejected. A matched recording starts from the beginning, with “Playing clean version” shown. No match or lookup failure keeps the original recording and shows that status. Spotify’s non-explicit flag is not a guarantee for custom filters; lyrics may also describe the explicit edit. The lookup is metadata-only, bounded and cancellable, with no new scopes or backend changes.

When timed filtering is enabled, browsers that pass a local volume readback check can mute the entire mix around estimated word positions. The estimate weights words within each LRCLIB line; it is not provider word timing and can miss words or silence nearby music. The player saves the prior volume, sets zero for a mute and restores it afterward. Volume commands are serialized so a late mute is followed by restoration. Pause, seeking out of a mute, profile/track changes, disabling filters, faults and disposal request restoration. No vocal isolation or Spotify audio processing occurs.

On iPhone/iPad, failed volume checks or with **Mute around words** off, mute rules fall back to whole-line seeks. Section rules still seek whole lines; skip-song rules stop playback rather than advancing an unknown queue. Timed filtering stays opt-in, independently of the clean-version preference. Unsupported topics/categories remain visible. No matches is not a clean verdict. The same transient lyric lookup feeds the display and planner; nothing is copied to Convex.

The scheduler uses SDK position plus a monotonic clock, ticks every 50ms and pads actions by 200ms. Rewinding and pause/resume re-arm spans. Missing lyrics pause enabled filtering; hidden pages, stale updates or failed/hung commands request a pause and show recovery. Background filtering is unsupported. The user confirmed the earlier Creep whole-line skip test worked. New mute/clean-selection checks use simulated Spotify commands and metadata with real LRCLIB lyrics; audible muting and actual clean-version availability still need real-device testing.

## Spotify + Convex setup

```sh
pnpm dev:convex
# In another terminal; values are entered privately at the prompt:
pnpm exec convex env set SPOTIFY_CLIENT_SECRET
```

The development backend is now the cloud deployment `your-deployment` in the `audio-angel` project. Keep `pnpm dev:convex` running while editing functions. The PWA uses the cloud client URL; authentication is forwarded through the registered Tailscale callback. Do not reuse development auth secrets in production.

Backend variables: `SITE_URL` (PWA origin), `AUTH_PUBLIC_URL` (public Convex HTTP origin, needed for a Tailscale proxy), `BETTER_AUTH_SECRET`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`. The generated Convex backend also supplies `CONVEX_SITE_URL`. The Settings screen reports setup readiness and the exact Spotify callback URI. Register that callback in the Spotify developer dashboard and allowlist each test account.

Current preview endpoints (tailnet only):
- App: `https://your-machine.your-tailnet.ts.net:8450`
- Convex client/WebSocket: `https://your-deployment.convex.cloud`
- Convex HTTP/auth: `https://your-machine.your-tailnet.ts.net:8452`
- Spotify callback: `https://your-machine.your-tailnet.ts.net:8452/api/auth/callback/spotify`

The user must be on the tailnet for the PWA and callback origins. Tailscale routes both 8450 and 8452 to the app server on port3101. `/api/auth/*` is forwarded to the configured HTTPS Convex site, with the upstream Host set correctly and redirects/cookies preserved. Set `AUTH_UPSTREAM_URL=https://your-deployment.convex.site` in the root `.env.local`; `pnpm start` reads that file. The old 8451 local proxy is unused. The Railway container remains the static/lyrics server; it does not contain a production Convex database.

Signing out ends the app session, but does not delete the account or revoke Spotify's authorization. Revoke access from Spotify’s account/apps page. Local profiles are not synced to Convex yet. Followed shows are not proof of paid subscription entitlement, and the podcast transcripts are fetched via Taddy for display only.

## Next integrations

The playback pilot uses Better Auth Spotify social sign-in backed by the Convex Better Auth component, and the Web Playback SDK loaded from Spotify at runtime. Library requests saved music, playlists, podcasts, episodes and followed artists. Provider tokens are encrypted in Convex; only short-lived access tokens are sent to the browser for Spotify API and SDK calls. The player connection persists while navigating within the app. The `/spotify` screen also shows synced lyrics via the server's `GET /api/lyrics` route, which proxies LRCLIB: only track title/artist/album/duration are sent — no Spotify tokens, audio or account data. For Spotify episodes, `GET /api/podcast-transcript` searches Taddy with the show name, episode title and duration, then downloads a matching publisher- or Taddy-hosted transcript (SRT/VTT/Podcasting 2.0 JSON) for line-timed display; transcripts are not filtered. Server-side, transcript file fetches are HTTPS-only, reject private/loopback hosts and redirects, cap at 5 MiB, and never forward Taddy credentials to non-Taddy hosts. Taddy credentials live in the root `.env.local` as `TADDY_USER_ID`/`TADDY_API_KEY` (`pnpm --filter @audio-angel/server start` loads them); the provider caches results briefly in memory to protect the free plan's 500-request monthly quota. The lyrics and transcript APIs require the same-origin built preview (server on port 3101), not the Expo dev server on 8081. Catalog search and a foreground line-skipping scheduler are now connected. Still ahead: real audible verification, BrowserStack measurements, word timing, muting and wider vocabulary coverage. Native adapters later require development builds. iPhone cannot mute Spotify. PWA installation, workers and wake locks do not guarantee background filtering. Full lyric filtering permissions and Spotify policy compatibility remain unresolved.

No Spotify audio capture, recording, decoding, transcription, analysis or AI ingestion. Diagnostics contain no tokens, audio or lyric text. The service worker only caches build-owned shell files.

## Attribution

Theme and component patterns adapted from [T3 Code mobile](https://github.com/pingdotgg/t3code/tree/main/apps/mobile). See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for the MIT notice. Audio Angel uses its own name and icon.

## Capstone agent

`agent/` holds the standalone Python capstone: a Streamlit app where a
Pydantic AI agent (Fireworks GLM 5.3 Flash) flags words to mute in
Audius songs or podcast episodes, then renders a muted MP3 to compare —
with a lexicon knowledge base, Logfire observability, evals, and a
feedback loop. See `agent/README.md`; quick start: `cd agent && uv sync
&& make app`.
