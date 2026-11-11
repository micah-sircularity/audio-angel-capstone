# Demo video script (~7 minutes)

Follows the story in [Building the Audio Angel Engine](https://thetexashacker.com/blog/building-the-audio-angel-engine/):
prepare the audio, decide what to filter, review, render, then evaluate and monitor.

## Before recording

- `cd agent && make app` and open http://localhost:8501.
- Run each song below once beforehand. Audio, vocal stems and transcripts are
  cached after the first run, so on camera only the agent call (~45 s) is live.
  Cut the wait in editing, or talk over it about the tools.
- Have `agent/README.md` open on the architecture diagram and the evaluation tables.

## 1. The problem (0:00–0:45)

Say: an explicit label is one bit of information. It doesn't tell you which
words or topics matter to *you*. Audio Angel lets the listener write the
rules and the software adapts the song around them. I call this agentic
accessibility.

## 2. Song one: "All My Life" (Audius, `aud:W6dKv9l`) (0:45–2:30)

1. Listen page → pick the track.
2. Rules: tick Profanity, Slurs, Graphic violence. Under "Custom things to
   mute" add **insults and put-downs**; under "Topics to mute" add
   **death and dying** (topics mute whole lines).
3. Click **Find what to mute**. Narrate the stages: download → Spleeter on a
   Modal GPU separates vocals from the beat → Deepgram transcribes the vocals
   with per-word timestamps → the agent reads the lines against my rules.
4. Walk the flags table. Expected highlights:
   - line 5: slur, "hell", and violence words such as *slug*, *shots*, *gunshots*.
     "Slug" means a bullet here, which a keyword list wouldn't know.
   - line 8: "bitch" flagged twice: as profanity **and** under my custom
     insults rule. One word can break two rules.
5. Click **Render muted audio** and play original vs muted. Point out that the
   beat keeps playing: only the vocal stem is silenced, then remixed.

## 3. Song two: "2010 SOUR DIESEL" (`aud:PjA2zP1`) (2:30–3:45)

Slang showcase. Rules: Drugs, Profanity, plus custom **"bragging about money"**.

- Flags include *gas*, *diesel*, *OCB*, *THC*, *spark it*. These are slang the
  model resolves by calling `search_lexicon` on the knowledge base.
- Tie back to the blog's "high" example: same word, different meaning by
  context. That's why the agent has `get_context` and `search_transcript`.
- Render and play a few seconds.

## 4. Song three: "Heaven Got My Number" (`aud:M2Y7WxQ`) (3:45–4:30)

What it should **not** mute. Rules: Drugs + topics "drug use or dealing" and
"death and dying". My hand label says nothing on this track meets those rules.

- Show the result. If it flags nothing, that's the correct answer. If it does
  flag something, that's the precision problem the eval measures. Mark the
  flag's verdict as wrong and click **Save feedback**: that's the feedback
  loop, and `make feedback-to-gt` turns it into eval data.
- Say the blog line: a track with no flags isn't a guarantee that everything was caught.

## 5. Architecture (4:30–5:30)

Show the README mermaid diagram. Stages: sources (Audius / podcast RSS) →
ffmpeg → Spleeter on Modal → Deepgram → Pydantic AI agent on Fireworks GLM
with 3 tools over a lexicon knowledge base (hybrid text + vector retrieval) →
plain code maps words to time intervals → ffmpeg renders. Logfire traces every
model and tool call.

## 6. Evaluation (5:30–6:30)

- Label page: open a ground-truth file. I hand-labeled 15 tracks: the agent
  pre-fills a draft, I correct every flag and save.
- README tables: retrieval eval (hybrid wins, hit@1 0.88), v3 vs v4 prompt,
  confidence-threshold sweep, ablations. v4 at 0.7 confidence: precision
  0.63, recall 0.81, F1 0.71, up from 0.61.
- Be honest: v4 was tuned on these same 15 songs, so these are development-set numbers.

## 7. Monitoring + wrap-up (6:30–7:15)

- Monitor page: runs, latency, flags, feedback verdicts.
- Close on the limitations from the blog: sung vocals are hard to
  transcribe, it's not real-time yet, and streaming providers don't expose the
  audio. Next step: fast and accurate enough to trust during playback.
