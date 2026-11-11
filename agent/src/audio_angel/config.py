"""Agent run configuration shared by the Streamlit app and the evals.

Defaults are the current best configuration from `make eval-tune`; update
them only from a tuning report (reports/tuning.md).
"""

from __future__ import annotations

from dataclasses import dataclass

GLM_FLASH = "fireworks:accounts/fireworks/models/glm-5p3-flash"


@dataclass(frozen=True)
class AgentConfig:
    model: str = GLM_FLASH
    # v3 replaced v2 after a live miss ("ass"/"hell" in long sung lines);
    # confirm with `make eval-tune` once ground truth exists.
    prompt_version: str = "v3"
    # Transcript lines per agent call ("chunking").
    chunk_size: int = 25
    # Retriever behind search_lexicon / search_transcript.
    search_method: str = "hybrid"
    # Flags below this confidence are dropped before planning.
    min_confidence: float = 0.5
    # False disables all tools: the plain-LLM baseline.
    tools_enabled: bool = True
    # Pre-match each chunk against the lexicon deterministically and
    # inject the hits into the batch prompt as evidence. The model still
    # judges each hit by its definition; this only removes "never looked
    # the word up" misses. Works with tools_enabled=False.
    lexicon_prematch: bool = True

    @property
    def name(self) -> str:
        tools = "tools" if self.tools_enabled else "notools"
        pre = "pre" if self.lexicon_prematch else "nopre"
        return (
            f"{self.prompt_version}-chunk{self.chunk_size}-{self.search_method}"
            f"-{tools}-{pre}-conf{self.min_confidence}"
        )
