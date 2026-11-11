"""Tuning grid for the flagging eval. Every run of `make eval-tune` evaluates
each configuration on the full ground-truth dataset and writes one row per
configuration to reports/tuning.md. The winner (highest mean line-level F1,
ties broken by lower mean latency) becomes the app default in
audio_angel/config.py, and the README records why.
"""

from __future__ import annotations

from itertools import product

from audio_angel.config import AgentConfig

BASELINE = AgentConfig(prompt_version="v1", tools_enabled=False)

# Stage 1: prompt x chunk size with the default retriever.
STAGE1 = [
    AgentConfig(prompt_version=p, chunk_size=c)
    for p, c in product(("v1", "v2", "v3"), (10, 25, 50))
]
# Stage 2: retriever and tool ablation on the stage-1 winner's prompt/chunk.
STAGE2_SEARCH_METHODS = ("text", "vector", "hybrid")
# Stage 3: confidence threshold on the stage-2 winner (no new model calls:
# re-score the stage-2 winner's raw flags at each threshold).
STAGE3_THRESHOLDS = (0.3, 0.5, 0.7, 0.8)
