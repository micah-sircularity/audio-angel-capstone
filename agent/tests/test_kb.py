import pytest

from audio_angel.kb.lexicon import CATEGORIES, LexiconEntry, entry_doc, load_lexicon
from audio_angel.kb.search import (
    HybridSearch,
    TextSearch,
    VectorSearch,
    build_retriever,
)
from audio_angel.kb.transcript_index import (
    build_transcript_retriever,
    transcript_docs,
)

DOCS = [
    {
        "id": "d1",
        "term": "molly",
        "variants": "mdma ecstasy",
        "category": "drugs",
        "definition": "Slang for MDMA.",
        "text": "molly mdma ecstasy Slang for MDMA.",
    },
    {
        "id": "d2",
        "term": "snow",
        "variants": "blow",
        "category": "drugs",
        "definition": "Slang for cocaine.",
        "text": "snow blow Slang for cocaine.",
    },
    {
        "id": "d3",
        "term": "hammer",
        "variants": "tool",
        "category": "violence",
        "definition": "A blunt weapon.",
        "text": "hammer tool A blunt weapon.",
    },
]


def test_lexicon_loads_and_validates():
    entries = load_lexicon()
    assert len(entries) >= 100
    ids = [e.id for e in entries]
    assert len(set(ids)) == len(ids)
    assert {e.category for e in entries} == set(CATEGORIES)
    assert all(isinstance(e, LexiconEntry) for e in entries)
    assert all(e.severity in ("mild", "strong") for e in entries)


def test_entry_doc_shape():
    doc = entry_doc(load_lexicon()[0])
    assert {"id", "term", "variants", "category", "definition", "text"} <= set(doc)


def test_text_search_ranks_matching_doc():
    search = TextSearch(DOCS)
    hits = search.search("what does molly mean", k=3)
    assert hits and hits[0][0] == "d1"
    # unrelated query returns nothing
    assert TextSearch(DOCS).search("zzzzq", k=3) == []


def test_vector_search_with_fake_embedder(fake_embedder):
    search = VectorSearch(DOCS, embedder=fake_embedder, model="fake")
    hits = search.search("mdma ecstasy drug", k=2)
    assert hits and hits[0][0] == "d1"


def test_hybrid_rrf_fuses_rankings(fake_embedder):
    search = HybridSearch(DOCS, embedder=fake_embedder)
    hits = search.search("cocaine slang", k=3)
    ids = [doc_id for doc_id, _ in hits]
    assert "d2" in ids
    # scores are RRF-fused, descending
    scores = [s for _, s in hits]
    assert scores == sorted(scores, reverse=True)


def test_build_retriever_methods_and_bad_method(fake_embedder):
    assert isinstance(build_retriever("text", DOCS), TextSearch)
    assert isinstance(
        build_retriever("vector", DOCS, embedder=fake_embedder), VectorSearch
    )
    assert isinstance(
        build_retriever("hybrid", DOCS, embedder=fake_embedder), HybridSearch
    )
    with pytest.raises(ValueError, match="unknown search method"):
        build_retriever("magic", DOCS)


def test_transcript_index_builds_line_and_window_docs(music_transcript):
    docs = transcript_docs(music_transcript)
    assert len(docs) == 2 * len(music_transcript.segments)
    window = next(d for d in docs if d["id"] == "window:1")
    assert "damn good day" in window["text"]
    assert "hello there" in window["text"]


def test_transcript_retriever_finds_lines(music_transcript):
    retriever = build_transcript_retriever(music_transcript, "text")
    hits = retriever.search("damn", k=5)
    indices = {int(doc_id.split(":")[1]) for doc_id, _ in hits}
    assert {1, 2} <= indices
