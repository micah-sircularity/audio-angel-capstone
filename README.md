# Audio Angel

Tell your music player what you want to avoid, and it edits the song around
that choice: individual words are muted against rules the listener writes,
instead of skipping whole "explicit" tracks.

Background:
[Building the Audio Angel engine](https://thetexashacker.com/blog/building-the-audio-angel-engine/)
and [Agentic accessibility](https://thetexashacker.com/blog/agentic-accessibility/).

## AI Engineering Buildcamp capstone → [`agent/`](agent/README.md)

The capstone is the standalone Python app in [`agent/`](agent/README.md): pick
an Audius song or podcast episode, define what to mute, and a Pydantic AI agent
with a slang knowledge base flags the words and renders a muted MP3. It covers
Spleeter vocal separation on Modal, Deepgram transcription, Logfire monitoring,
hand-labeled evaluation and tuning, and a feedback loop.

```sh
cd agent && uv sync && make app   # http://localhost:8501
```

Everything a reviewer needs (problem, architecture, retrieval and agent
evaluation, monitoring, reproducibility and self-evaluation) is in
[`agent/README.md`](agent/README.md).

## Original prototype (Expo + Convex)

The rest of this repository is the earlier prototype: an Expo PWA music player
with listening profiles, Spotify sign-in and playback (Premium), synced lyrics
from LRCLIB, and line-skipping / estimated word muting. It is kept for
reference and is not part of the capstone.

```sh
corepack enable   # Node 22+, pnpm 11.10.0
pnpm install
pnpm dev          # web on http://localhost:8081
pnpm lint && pnpm typecheck && pnpm test
```

Spotify features need a Convex deployment (`pnpm dev:convex`) with
`SITE_URL`, `BETTER_AUTH_SECRET`, `SPOTIFY_CLIENT_ID` and
`SPOTIFY_CLIENT_SECRET` set as Convex environment variables; `.env.example`
documents the client-side values.

| path | contents |
|---|---|
| `agent/` | the capstone (Python, Streamlit, Pydantic AI) |
| `apps/app` | Expo Router app (web + future native) |
| `apps/server` | static serving, health check, lyrics/transcript proxy |
| `convex/` | auth, Spotify token storage, media functions |
| `packages/contracts` | shared schemas and interfaces |
| `packages/filters` | term matching and action planning |

## Attribution

Theme and component patterns adapted from
[T3 Code mobile](https://github.com/pingdotgg/t3code/tree/main/apps/mobile).
See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for the MIT notice.
