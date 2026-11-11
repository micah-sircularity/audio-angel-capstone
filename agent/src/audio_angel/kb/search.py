"""Retrievers over document dicts. One interface: search(query, k) ->
list[(doc_id, score)]. Three backends: minsearch TF-IDF text search,
Fireworks vector search (OpenAI-compatible embeddings + numpy cosine),
and a reciprocal-rank-fusion hybrid.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Protocol

import numpy as np
from minsearch import Index

from audio_angel.helpers.paths import cache_dir

# Serverless on Fireworks; verified against
# https://docs.fireworks.ai/guides/querying-embeddings-models
EMBEDDING_MODEL = "nomic-ai/nomic-embed-text-v1.5"
FIREWORKS_BASE_URL = "https://api.fireworks.ai/inference/v1"
# nomic-embed-text-v1.5 is trained with task prefixes; embeddings made
# without them degrade noticeably.
DOC_PREFIX = "search_document: "
QUERY_PREFIX = "search_query: "
EMBED_BATCH = 64
_RRF_K = 60

Doc = dict


class Retriever(Protocol):
    def search(self, query: str, k: int = 5) -> list[tuple[str, float]]: ...


def _doc_text(doc: Doc) -> str:
    return doc.get("text") or " ".join(
        str(doc.get(field, "")) for field in ("term", "variants", "definition")
    )


class TextSearch:
    """minsearch TF-IDF index over the doc's text fields."""

    def __init__(self, docs: list[Doc]):
        self.docs = {doc["id"]: doc for doc in docs}
        self._ids = [doc["id"] for doc in docs]
        index_docs = [
            {
                "id": doc["id"],
                "text": _doc_text(doc),
                "category": doc.get("category", ""),
            }
            for doc in docs
        ]
        self._index = Index(text_fields=["text"], keyword_fields=["category"])
        self._index.fit(index_docs)
        self._scores: dict[str, float] = {}

    def search(self, query: str, k: int = 5) -> list[tuple[str, float]]:
        if not query.strip() or not self._ids:
            return []
        # minsearch returns docs ranked by score but doesn't expose the
        # raw score; re-rank positions as a decayed score and keep order.
        hits = self._index.search(query, num_results=max(k, 1))
        results: list[tuple[str, float]] = []
        for rank, hit in enumerate(hits[:k]):
            doc_id = hit["id"] if isinstance(hit, dict) else self._ids[hit]
            results.append((doc_id, 1.0 / (rank + 1)))
        return results


class Embedder(Protocol):
    """Injectable embedding client (tests substitute a fake)."""

    def embed(self, texts: list[str]) -> np.ndarray: ...


class FireworksEmbedder:
    """Fireworks embeddings via the OpenAI SDK."""

    def __init__(self, model: str = EMBEDDING_MODEL, api_key: str | None = None):
        from openai import OpenAI

        api_key = api_key or os.environ.get("FIREWORKS_API_KEY", "").strip()
        if not api_key:
            raise ValueError(
                "FIREWORKS_API_KEY is not set; vector search is unavailable"
            )
        self._client = OpenAI(base_url=FIREWORKS_BASE_URL, api_key=api_key)
        self.model = model

    def embed(self, texts: list[str]) -> np.ndarray:
        # Embed unprefixed texts; callers add nomic task prefixes.
        out: list[np.ndarray] = []
        for i in range(0, len(texts), EMBED_BATCH):
            batch = texts[i : i + EMBED_BATCH]
            response = self._client.embeddings.create(model=self.model, input=batch)
            out.append(
                np.array([item.embedding for item in response.data], dtype=np.float32)
            )
        return np.vstack(out) if out else np.zeros((0, 0), dtype=np.float32)


def _embeddings_cache_path(model: str, docs: list[Doc]) -> Path:
    # Prefix choice is part of the cache key: prefixed and unprefixed
    # embeddings are not interchangeable.
    digest = hashlib.sha256(
        (
            model + "|" + DOC_PREFIX + "\n" + "\n".join(_doc_text(doc) for doc in docs)
        ).encode()
    ).hexdigest()[:32]
    return cache_dir("embeddings") / f"{digest}.npy"


class VectorSearch:
    """Cosine-similarity search over cached document embeddings."""

    def __init__(
        self,
        docs: list[Doc],
        *,
        embedder: Embedder | None = None,
        model: str = EMBEDDING_MODEL,
    ):
        self.docs = {doc["id"]: doc for doc in docs}
        self._ids = [doc["id"] for doc in docs]
        self._embedder = embedder or FireworksEmbedder(model=model)
        self._model = model
        self._matrix: np.ndarray | None = None

    def _doc_embeddings(self) -> np.ndarray:
        if self._matrix is None:
            path = _embeddings_cache_path(self._model, list(self.docs.values()))
            if path.exists():
                self._matrix = np.load(path)
            else:
                texts = [_doc_text(self.docs[doc_id]) for doc_id in self._ids]
                self._matrix = (
                    self._embedder.embed(texts) if texts else np.zeros((0, 0))
                )
                np.save(path, self._matrix)
        return self._matrix

    def search(self, query: str, k: int = 5) -> list[tuple[str, float]]:
        if not query.strip() or not self._ids:
            return []
        matrix = self._doc_embeddings()
        if matrix.size == 0:
            return []
        query_vec = self._embedder.embed([QUERY_PREFIX + query])[0]
        doc_norms = np.linalg.norm(matrix, axis=1)
        query_norm = np.linalg.norm(query_vec)
        denom = doc_norms * query_norm
        denom[denom == 0] = 1e-9
        scores = (matrix @ query_vec) / denom
        order = np.argsort(-scores)[:k]
        return [
            (self._ids[int(i)], float(scores[int(i)]))
            for i in order
            if scores[int(i)] > 0
        ]


def _rrf(rankings: list[list[tuple[str, float]]], k: int) -> list[tuple[str, float]]:
    """Reciprocal rank fusion over already-ranked (doc_id, score) lists."""
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, (doc_id, _) in enumerate(ranking):
            scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (_RRF_K + rank + 1)
    return sorted(scores.items(), key=lambda item: -item[1])[:k]


class HybridSearch:
    """RRF(k=60) over TextSearch + VectorSearch rankings."""

    def __init__(self, docs: list[Doc], *, embedder: Embedder | None = None):
        self._text = TextSearch(docs)
        self._vector = VectorSearch(docs, embedder=embedder)

    def search(self, query: str, k: int = 5) -> list[tuple[str, float]]:
        # Pull more candidates than k so the fusion has signal.
        depth = max(k * 4, 20)
        return _rrf(
            [self._text.search(query, depth), self._vector.search(query, depth)],
            k,
        )


def build_retriever(
    method: str,
    docs: list[Doc],
    *,
    embedder: Embedder | None = None,
) -> Retriever:
    """Factory: 'text' | 'vector' | 'hybrid'."""
    if method == "text":
        return TextSearch(docs)
    if method == "vector":
        return VectorSearch(docs, embedder=embedder)
    if method == "hybrid":
        return HybridSearch(docs, embedder=embedder)
    raise ValueError(f"unknown search method {method!r}")
