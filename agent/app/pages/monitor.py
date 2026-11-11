"""Monitor page: KPIs and trends from data/logs/runs.jsonl +
feedback.jsonl. Phase-2 observability companion to Logfire.
"""

from __future__ import annotations

import os
from collections import Counter

import pandas as pd
import streamlit as st

from audio_angel.feedback import load_feedback, load_runs

st.set_page_config(page_title="Audio Angel — Monitor", page_icon="📈", layout="wide")

st.title("Run monitor")

runs = load_runs()
feedback = load_feedback()
project_url = os.environ.get("LOGFIRE_PROJECT_URL", "").strip()
if project_url:
    st.link_button("Open in Logfire", project_url)

if not runs:
    st.info(
        "No runs logged yet. Run the flagging agent on the Listen page "
        "and data/logs/runs.jsonl will appear here."
    )
    st.stop()

if not runs:
    raise SystemExit(0)  # bare-mode safety; st.stop() covers the real app

df = pd.DataFrame(runs)
df["ts"] = pd.to_datetime(df["ts"], errors="coerce")
df["ok"] = df["error"].isna()

# ---------- KPIs ----------
errors = int((~df["ok"]).sum())
cols = st.columns(6)
cols[0].metric("Runs", len(df))
cols[1].metric("Error rate", f"{errors / len(df):.0%}")
cols[2].metric("Mean latency", f"{df['latency_ms'].mean():.0f} ms")
cols[3].metric("p95 latency", f"{df['latency_ms'].quantile(0.95):.0f} ms")
total_in, total_out = int(df["input_tokens"].sum()), int(df["output_tokens"].sum())
cols[4].metric("Tokens", f"{total_in + total_out:,}")
cols[5].metric("Est. cost", f"${total_in * 0.15 / 1e6 + total_out * 0.50 / 1e6:.4f}")

# ---------- charts ----------
c1, c2 = st.columns(2)
with c1:
    st.caption("Latency over time (ms)")
    st.line_chart(df.set_index("ts")["latency_ms"])
    st.caption("Flags per run")
    st.bar_chart(df.set_index("ts")["n_flags"])
with c2:
    st.caption("Tokens per run")
    st.area_chart(df.set_index("ts")[["input_tokens", "output_tokens"]])
    tool_counts = Counter()
    for calls in df["tool_calls"].dropna():
        tool_counts.update(calls)
    if tool_counts:
        st.caption("Tool calls")
        st.bar_chart(pd.Series(tool_counts))

# ---------- breakdowns ----------
st.subheader("By config")
by_config = (
    df.assign(config=df["config"].map(lambda c: (c or {}).get("name", "?")))
    .groupby("config")
    .agg(
        runs=("run_id", "count"),
        errors=("ok", lambda s: int((~s).sum())),
        mean_latency_ms=("latency_ms", "mean"),
        mean_flags=("n_flags", "mean"),
        input_tokens=("input_tokens", "sum"),
        output_tokens=("output_tokens", "sum"),
    )
    .round(1)
)
st.dataframe(by_config, use_container_width=True)

st.subheader("Feedback")
if feedback:
    fdf = pd.DataFrame(feedback)
    counts = fdf["verdict"].value_counts()
    up = int(counts.get("up", 0))
    down = int(counts.get("down", 0))
    missed = int(counts.get("missed", 0))
    fcols = st.columns(3)
    fcols[0].metric("Approval rate", f"{up / (up + down):.0%}" if up + down else "—")
    fcols[1].metric("👎 wrong flags", down)
    fcols[2].metric("Missed reports", missed)
    st.dataframe(fdf.tail(20), use_container_width=True, hide_index=True)
else:
    st.caption("No feedback recorded yet.")

# ---------- recent runs + errors ----------
st.subheader("Last 20 runs")
show = df.sort_values("ts", ascending=False).head(20)[
    ["ts", "title", "kind", "n_flags", "latency_ms", "requests", "error"]
]
st.dataframe(show, use_container_width=True, hide_index=True)

err_df = df[~df["ok"]]
if not err_df.empty:
    st.subheader("Recent errors")
    st.dataframe(
        err_df[["ts", "title", "error"]].tail(10),
        use_container_width=True,
        hide_index=True,
    )
