"""Listen page: pick a track or episode, define mute rules, let the
agent flag offending words, review with feedback, then render and
compare muted audio.
"""

from __future__ import annotations

import pandas as pd
import streamlit as st
from components import (
    env_warnings,
    fmt_ms,
    rules_signature,
    run,
    source_picker,
)

from audio_angel import pipeline
from audio_angel.agent.prompts import CATEGORY_DEFINITIONS, PROMPT_VERSIONS
from audio_angel.config import AgentConfig
from audio_angel.feedback import FeedbackRecord, append_feedback
from audio_angel.models import (
    LineFlag,
    MuteRule,
    Track,
    category_rule,
    term_rule,
    topic_rule,
)
from audio_angel.paths import cache_dir, safe_key
from audio_angel.plan import flags_to_intervals
from audio_angel.separation import separation_enabled, stems_dir

st.set_page_config(page_title="Audio Angel — Listen", page_icon="🎧", layout="wide")
env_warnings()

st.title("Audio Angel")
st.caption("Pick a song or podcast, say what to mute, hear the result.")

# ---------- 1. source picker ----------
st.subheader("1. Choose audio")
track: Track | None = source_picker()

# ---------- 2. rules ----------
st.subheader("2. Mute rules")
cols = st.columns(3)
category_labels = {key: d.split(":")[0] for key, d in CATEGORY_DEFINITIONS.items()}
chosen_categories = []
for i, (key, definition) in enumerate(CATEGORY_DEFINITIONS.items()):
    with cols[i % 3]:
        if st.checkbox(
            category_labels[key],
            value=key in ("profanity", "slurs"),
            help=definition,
            key=f"cat_{key}",
        ):
            chosen_categories.append(key)
terms_text = st.text_area(
    "Custom things to mute, in your own words (one rule per line)",
    help='Describe what to mute, e.g. "mischief, violence, brashness" or "insults about someone\'s mom". The agent mutes the matching words by meaning, not exact spelling.',
    height=80,
    key="terms",
)
topics_text = st.text_area(
    "Topics to mute (mutes whole lines that discuss them; one per line)",
    height=80,
    key="topics",
)

with st.expander("Advanced — agent configuration"):
    defaults = AgentConfig()
    model = st.text_input("Model", value=defaults.model)
    prompt_version = st.selectbox(
        "Prompt version",
        PROMPT_VERSIONS,
        index=PROMPT_VERSIONS.index(defaults.prompt_version),
    )
    chunk_size = int(
        st.number_input("Chunk size (lines per call)", 5, 100, defaults.chunk_size)
    )
    search_method = st.selectbox(
        "Search method",
        ("text", "vector", "hybrid"),
        index=("text", "vector", "hybrid").index(defaults.search_method),
    )
    min_confidence = st.slider(
        "Min confidence", 0.0, 1.0, float(defaults.min_confidence), 0.05
    )
    tools_enabled = st.checkbox("Tools enabled", value=defaults.tools_enabled)

config = AgentConfig(
    model=model,
    prompt_version=prompt_version,
    chunk_size=chunk_size,
    search_method=search_method,
    min_confidence=min_confidence,
    tools_enabled=tools_enabled,
)

rules: list[MuteRule] = [
    category_rule(c, label=category_labels[c]) for c in chosen_categories
]
rules += [term_rule(t) for t in terms_text.splitlines() if t.strip()]
rules += [topic_rule(t) for t in topics_text.splitlines() if t.strip()]

# Analysis results are keyed to exactly what produced them; a rerun with
# different inputs drops stale results instead of showing them.
analysis_key = (
    f"{track.source_key}|{rules_signature(rules)}|{config.name}" if track else None
)
if st.session_state.get("analysis", {}).get("key") not in (None, analysis_key):
    st.session_state.pop("analysis", None)

# ---------- 3. flag ----------
st.subheader("3. Find what to mute")
separate_vocals = st.checkbox(
    "Isolate vocals (Spleeter on Modal)",
    value=separation_enabled(track) if track else False,
    disabled=track is None,
    help="Separates the vocal stem on a Modal T4 before transcribing "
    "and mutes only the vocals — cleaner results on music.",
)
if st.button("Find what to mute", type="primary", disabled=track is None or not rules):
    try:
        with st.status("Preparing audio…", expanded=True) as status:
            st.write("Downloading audio…")
            sep_status: dict = {}
            transcript = run(
                pipeline.prepare(
                    track,
                    use_separation=separate_vocals,
                    separation_status=sep_status,
                )
            )
            st.session_state.sep_status = sep_status
            if sep_status.get("separation", "").startswith("failed"):
                st.warning(
                    "Vocal separation failed — using the full mix. "
                    f"({sep_status['separation']})"
                )
            if not transcript.segments:
                status.update(label="No vocals detected", state="complete")
                st.warning(
                    "No vocals detected in this audio — it's probably "
                    "instrumental. Pick a track with clear vocals "
                    "(Hip-Hop/Rap works well)."
                )
                st.stop()
            st.write(f"Transcribed {len(transcript.segments)} lines.")
            progress = st.empty()

            def on_progress(done: int, total: int) -> None:
                progress.write(f"Flagging chunk {done}/{total}…")

            result, intervals, run_id = run(
                pipeline.analyze(
                    transcript,
                    track,
                    rules,
                    config,
                    on_progress=on_progress,
                    separation_status=st.session_state.get("sep_status"),
                )
            )
            status.update(label="Flagging complete", state="complete")
        st.session_state.analysis = {
            "key": analysis_key,
            "transcript": transcript,
            "result": result,
            "intervals": intervals,
            "rules": rules,
            "run_id": run_id,
            "feedback_saved": False,
        }
    except Exception as exc:  # noqa: BLE001
        st.error(f"Pipeline failed: {exc}")

# ---------- 4. results + feedback ----------
analysis = st.session_state.get("analysis")
if analysis and analysis.get("key") == analysis_key:
    result = analysis["result"]
    transcript = analysis["transcript"]
    run_id = analysis.get("run_id", "")
    st.subheader("4. Review flags")
    fb_note = (
        f" · {result.fallbacks} whole-line fallback(s)" if result.fallbacks else ""
    )
    st.caption(
        f"{len(result.flags)} flags kept "
        f"({len(result.raw_flags)} raw{fb_note}) · {result.requests} requests · "
        f"{result.input_tokens}+{result.output_tokens} tokens · "
        f"{result.latency_ms} ms · tools {result.tool_calls} · run `{run_id}`"
    )
    by_index = {s.index: s for s in transcript.segments}
    rows = [
        {
            "include": True,
            "verdict": "👍",
            "time": fmt_ms(by_index[f.line_index].start_ms),
            "line": by_index[f.line_index].text,
            "muted words": ", ".join(f.words) or "(whole line)",
            "rule": f.rule_id,
            "confidence": f.confidence,
            "reason": f.reason,
        }
        for f in result.flags
    ]
    columns = [
        "include",
        "verdict",
        "time",
        "line",
        "muted words",
        "rule",
        "confidence",
        "reason",
    ]
    df = pd.DataFrame(rows, columns=columns)
    if result.flags:
        edited = st.data_editor(
            df,
            hide_index=True,
            disabled=[c for c in df.columns if c not in ("include", "verdict")],
            column_config={
                "verdict": st.column_config.SelectboxColumn(
                    "verdict", options=["👍", "👎"], required=True
                )
            },
            use_container_width=True,
            key="flags_editor",
        )
    else:
        st.info(
            "No flags for these rules. Check the transcript below; if something "
            "should be muted, report it as a missed word."
        )
        edited = df
    st.markdown(f"**Transcript** · {len(transcript.segments)} lines")
    with st.container(height=420):
        flagged = {f.line_index for f in result.flags}
        for segment in transcript.segments:
            marker = "🔇 **" if segment.index in flagged else ""
            end = "**" if segment.index in flagged else ""
            st.markdown(
                f"{marker}`[{segment.index}] {fmt_ms(segment.start_ms)}` {end}{segment.text}{end}"
            )

    with st.expander("Report a missed word"):
        mc1, mc2, mc3 = st.columns(3)
        missed_line = mc1.number_input(
            "Line index", 0, max(len(transcript.segments) - 1, 0), 0
        )
        missed_rule = mc2.selectbox("Rule", [r.id for r in analysis["rules"]])
        missed_words = mc3.text_input("Words (comma-separated)", key="missed_words")

    def collect_feedback() -> list[FeedbackRecord]:
        records = [
            FeedbackRecord(
                run_id=run_id,
                source_key=track.source_key,
                line_index=f.line_index,
                rule_id=f.rule_id,
                words=f.words,
                confidence=f.confidence,
                verdict="down" if verdict == "👎" else "up",
            )
            for f, verdict in zip(
                result.flags, edited["verdict"].tolist(), strict=False
            )
        ]
        if missed_words.strip():
            records.append(
                FeedbackRecord(
                    run_id=run_id,
                    source_key=track.source_key,
                    line_index=int(missed_line),
                    rule_id=missed_rule,
                    words=[w.strip() for w in missed_words.split(",") if w.strip()],
                    verdict="missed",
                )
            )
        return records

    if st.button("Save feedback"):
        append_feedback(collect_feedback())
        st.session_state.analysis["feedback_saved"] = True
        st.toast("Feedback saved")

    # ---------- 5. render ----------
    st.subheader("5. Compare audio")
    if st.button("Render muted audio", type="primary"):
        included: list[LineFlag] = [
            flag
            for flag, keep in zip(
                result.flags, edited["include"].tolist(), strict=False
            )
            if keep
        ]
        intervals = flags_to_intervals(included, transcript).intervals
        try:
            muted_path = pipeline.render(track, intervals)
            st.session_state.muted = {
                "key": analysis_key,
                "path": str(muted_path),
                "intervals": len(intervals),
            }
            if not analysis.get("feedback_saved"):
                append_feedback(collect_feedback())
                st.session_state.analysis["feedback_saved"] = True
        except Exception as exc:  # noqa: BLE001
            st.error(f"Render failed: {exc}")
    muted = st.session_state.get("muted")
    if muted and muted.get("key") == analysis_key:
        original = cache_dir("audio") / f"{safe_key(track.source_key)}.mp3"
        st.caption(f"{muted['intervals']} mute intervals")
        stems_used = (
            stems_dir(track.source_key) / "meta.json"
        ).exists() and transcript.audio_source == "vocals"
        if stems_used:
            # Render the comparison from the same stems+gain so the A/B
            # loudness matches the muted output.
            original = pipeline.render(track, [])
        col1, col2 = st.columns(2)
        col1.markdown("**Original (from stems)**" if stems_used else "**Original**")
        col1.audio(str(original))
        col2.markdown("**Muted**")
        col2.audio(muted["path"])
