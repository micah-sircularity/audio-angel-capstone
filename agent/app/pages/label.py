"""Label page: build ground-truth flag files for evals.

Pick a track (same source picker as Listen) or open an existing
ground-truth file, transcribe (cached), optionally pre-fill with the
agent, edit rows, save as labeled_by="human".
"""

from __future__ import annotations

import pandas as pd
import streamlit as st
from components import (
    env_warnings,
    fmt_ms,
    run,
    source_picker,
)

from audio_angel import pipeline
from audio_angel.agent.flagger import _entry_in_line
from audio_angel.agent.prompts import CATEGORY_DEFINITIONS
from audio_angel.config import AgentConfig
from audio_angel.helpers.ground_truth import (
    ExpectedFlag,
    GroundTruth,
    list_ground_truth,
    load_ground_truth,
    save_ground_truth,
)
from audio_angel.models import Track, category_rule, term_rule, topic_rule
from audio_angel.pipeline.separation import separation_enabled

st.set_page_config(page_title="Audio Angel — Label", page_icon="🏷️", layout="wide")
env_warnings()

st.title("Label ground truth")
st.caption("Hand-label what should be muted; these files drive the evals.")

# ---------- open existing or pick a track ----------
existing = list_ground_truth()
drafts = list_ground_truth("draft")
with st.expander(
    f"Open an existing label file ({len(existing)} labeled, {len(drafts)} drafts)",
    expanded=not existing,
):
    options = (
        ["<new labeling session>"]
        + [p.stem for p in existing]
        + [f"[draft] {p.stem}" for p in drafts]
    )
    choice = st.selectbox("Label files", options)
    if choice != "<new labeling session>" and st.button("Open file"):
        index = options.index(choice) - 1
        path = (
            existing[index] if index < len(existing) else drafts[index - len(existing)]
        )
        gt = load_ground_truth(path)
        st.session_state.label_gt = gt
        st.session_state.selected_track = Track(
            source_key=gt.source_key,
            kind=gt.kind,
            title=gt.title,
            artist=gt.artist,
        )
        st.session_state.label_transcript = gt.transcript
        st.session_state.pop("label_rows", None)
        # Repopulate free-form rule boxes so custom rules survive re-save.
        st.session_state.lterms = "\n".join(
            r.value for r in gt.rules if r.kind == "term"
        )
        st.session_state.ltopics = "\n".join(
            r.value for r in gt.rules if r.kind == "topic"
        )

st.subheader("1. Choose audio")
track = source_picker()

gt_loaded: GroundTruth | None = st.session_state.get("label_gt")
if gt_loaded and track and gt_loaded.source_key != track.source_key:
    gt_loaded = None
    st.session_state.pop("label_gt", None)
    st.session_state.pop("label_transcript", None)

# ---------- rules ----------
st.subheader("2. Rules for this track")
gt = st.session_state.get("label_gt")
if gt:
    rules = gt.rules
    st.info(
        f"Loaded rules from file: {', '.join(r.id for r in rules)}. "
        "Edit below to change."
    )
else:
    rules = [
        category_rule(c, label=CATEGORY_DEFINITIONS[c].split(":")[0])
        for c in CATEGORY_DEFINITIONS
    ]
cols = st.columns(3)
chosen = []
for i, key in enumerate(CATEGORY_DEFINITIONS):
    with cols[i % 3]:
        default = not gt or any(r.id == key for r in rules)
        if st.checkbox(
            CATEGORY_DEFINITIONS[key].split(":")[0], value=default, key=f"lcat_{key}"
        ):
            chosen.append(key)
terms_text = st.text_area(
    "Custom things to mute, in your own words (one rule per line)",
    help='Describe what to mute, e.g. "mischief, violence, brashness" or "insults about someone\'s mom". The agent mutes the matching words by meaning, not exact spelling.',
    height=60,
    key="lterms",
)
topics_text = st.text_area(
    "Topics to mute (mutes whole lines that discuss them; one per line)",
    height=60,
    key="ltopics",
)
rules = [category_rule(c, label=CATEGORY_DEFINITIONS[c].split(":")[0]) for c in chosen]
rules += [term_rule(t) for t in terms_text.splitlines() if t.strip()]
rules += [topic_rule(t) for t in topics_text.splitlines() if t.strip()]

# ---------- transcript ----------
st.subheader("3. Transcript")
transcript = st.session_state.get("label_transcript")
if (
    transcript is not None
    and track is not None
    and transcript.source_key != track.source_key
):
    transcript = None
    st.session_state.pop("label_transcript", None)

separate_vocals = st.checkbox(
    "Isolate vocals (Spleeter on Modal)",
    value=separation_enabled(track) if track else False,
    disabled=track is None,
)
if st.button("Transcribe track", disabled=track is None):
    with st.spinner("Downloading + transcribing (cached)…"):
        try:
            sep_status: dict = {}
            transcript = run(
                pipeline.prepare(
                    track,
                    use_separation=separate_vocals,
                    separation_status=sep_status,
                )
            )
            if sep_status.get("separation", "").startswith("failed"):
                st.warning(
                    "Vocal separation failed — using the full mix. "
                    f"({sep_status['separation']})"
                )
            if not transcript.segments:
                st.warning(
                    "No vocals detected in this audio — it's probably "
                    "instrumental. Pick a track with clear vocals "
                    "(Hip-Hop/Rap works well)."
                )
            st.session_state.label_transcript = transcript
        except Exception as exc:  # noqa: BLE001
            st.error(f"Prepare failed: {exc}")

if transcript:
    st.success(f"{len(transcript.segments)} lines · {fmt_ms(transcript.duration_ms)}")

    # ---------- pre-fill ----------
    c1, c2 = st.columns(2)
    if c1.button("Pre-fill with agent (default config)"):
        with st.spinner("Agent flagging…"):
            try:
                result, _, _ = run(
                    pipeline.analyze(transcript, track, rules, AgentConfig())
                )
                st.session_state.label_rows = [
                    {
                        "line_index": f.line_index,
                        "rule_id": f.rule_id,
                        "words": ", ".join(f.words),
                    }
                    for f in result.flags
                ]
                st.session_state.prefilled_from = AgentConfig().name
                st.toast(f"Pre-filled {len(result.flags)} flags")
            except Exception as exc:  # noqa: BLE001
                st.error(f"Agent failed: {exc}")
    if c2.button("Start from scratch"):
        st.session_state.label_rows = []
        st.session_state.prefilled_from = None

    if "label_rows" not in st.session_state:
        st.session_state.label_rows = [
            {
                "line_index": e.line_index,
                "rule_id": e.rule_id,
                "words": ", ".join(e.words),
            }
            for e in (gt.expected if gt else [])
        ]

    # ---------- editor ----------
    st.subheader("4. Edit expected flags")
    by_index = {s.index: s for s in transcript.segments}
    df = pd.DataFrame(st.session_state.label_rows)
    if df.empty:
        df = pd.DataFrame(columns=["line_index", "rule_id", "words"])
    df["line"] = df["line_index"].map(
        lambda i: by_index[i].text if i in by_index else ""
    )
    edited = st.data_editor(
        df[["line_index", "line", "rule_id", "words"]],
        num_rows="dynamic",
        hide_index=True,
        disabled=["line"],
        column_config={
            "rule_id": st.column_config.SelectboxColumn(
                "rule_id", options=[r.id for r in rules], required=True
            ),
            "words": st.column_config.TextColumn(
                "words", help="Comma-separated; blank = whole line"
            ),
        },
        use_container_width=True,
        key="label_editor",
    )
    st.session_state.label_rows = edited[["line_index", "rule_id", "words"]].to_dict(
        "records"
    )

    with st.expander("Full transcript"):
        for segment in transcript.segments:
            st.markdown(
                f"`[{segment.index}] {fmt_ms(segment.start_ms)}` {segment.text}"
            )

    # ---------- save ----------
    notes = st.text_input("Notes for this label file", key="label_notes")
    if st.button("Save ground truth", type="primary"):
        errors = []
        expected: list[ExpectedFlag] = []
        rule_ids = {r.id for r in rules}
        for row_num, row in enumerate(st.session_state.label_rows, start=1):
            try:
                line_index = int(row["line_index"])
            except (TypeError, ValueError):
                errors.append(f"row {row_num}: line_index is not a number")
                continue
            segment = by_index.get(line_index)
            if segment is None:
                errors.append(f"row {row_num}: line_index {line_index} out of range")
                continue
            rule_id = row.get("rule_id") or ""
            if rule_id not in rule_ids:
                errors.append(f"row {row_num}: unknown rule {rule_id!r}")
                continue
            words = [
                w.strip() for w in str(row.get("words") or "").split(",") if w.strip()
            ]
            words_text = " ".join(w.text for w in segment.words)
            for word in words:
                if not _entry_in_line(word, segment.text) and not _entry_in_line(
                    word, words_text
                ):
                    errors.append(f"row {row_num}: {word!r} not in line {line_index}")
            expected.append(
                ExpectedFlag(line_index=line_index, rule_id=rule_id, words=words)
            )
        if errors:
            for e in errors:
                st.error(e)
        else:
            out = GroundTruth(
                source_key=track.source_key,
                title=track.title,
                artist=track.artist,
                kind=track.kind,
                rules=rules,
                transcript=transcript,
                expected=expected,
                labeled_by="human",
                prefilled_from=st.session_state.get("prefilled_from"),
                notes=notes,
            )
            path = save_ground_truth(out)
            st.success(f"Saved {len(expected)} expected flags → {path.name}")
            st.session_state.label_gt = out

st.divider()
st.caption(
    f"{len(list_ground_truth())} track(s) labeled so far (evals/data/ground_truth/)."
)
