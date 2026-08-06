"""End-to-end against a real embedded Qdrant, with a fake embedder in front.

These are the store-level halves of AT-14 (two chunkings coexist), AT-15
(re-running one analyzer preserves the others), AT-22 (content filters), AT-23
(recording scope) and AT-24 (absent content is reported as absent). The
retrieval-quality half of AT-19 to AT-24 needs the real embedder and the
ground-truth sheets, and stays in the scoring harness.
"""

import pytest

from conftest import indexable, scene

VIDEO_A = "aaaaaaaaaaaaaaaa"
VIDEO_B = "bbbbbbbbbbbbbbbb"
URL_A = "https://example.invalid/a.mp4"
URL_B = "https://example.invalid/b.mp4"
CONFIG = "audio_video:5-20"


def index(store, video_id=VIDEO_A, url=URL_A, analyzer="default_video", config=CONFIG,
          chunks=None):
    return store.add_chunks(
        video_id=video_id, video_url=url, chunks=chunks or [],
        extractor_id=analyzer, chunk_config=config,
    )


def shopper_chunks():
    return [
        indexable(0, 0.0, 10.0, scene(
            "a man in a red jacket pushes a trolley",
            people=["a man in a red jacket"], objects=["trolley"],
            actions=["pushing a trolley"], people_count=1)),
        indexable(1, 10.0, 20.0, scene(
            "two women examine bottles on a shelf",
            people=["a woman in a blue coat", "a woman with a handbag"],
            objects=["shelf", "bottle"], actions=["examining bottles"], people_count=2)),
        indexable(2, 20.0, 30.0, scene(
            "the aisle is empty", objects=[], people=[], people_count=0)),
    ]


def test_indexing_returns_the_number_of_points_written(chunk_store):
    assert index(chunk_store, chunks=shopper_chunks()) == 3
    assert chunk_store.count() == 3


def test_a_chunk_with_nothing_to_embed_is_skipped(chunk_store):
    """A silent chunk's transcript renders to no text. Indexing it would put an
    empty point in the way of every search."""
    empty = {"id": 0, "start": 0.0, "end": 10.0, "output": {}, "fields": {}}
    assert index(chunk_store, chunks=[empty]) == 0
    assert chunk_store.count() == 0


def test_re_indexing_the_same_chunks_upserts_instead_of_duplicating(chunk_store):
    """AT-13 at the store: the second run must leave the collection the size it
    found it."""
    index(chunk_store, chunks=shopper_chunks())
    index(chunk_store, chunks=shopper_chunks())
    assert chunk_store.count() == 3


def test_the_payload_carries_what_a_citation_needs(chunk_store):
    """Retrieval never joins back to the record store, so everything needed to
    rank, filter and play a moment has to be on the point."""
    index(chunk_store, chunks=shopper_chunks())
    hit = chunk_store.search("trolley", limit=1)[0]

    for field in ("video_id", "video_url", "chunk_id", "start", "end",
                  "extractor_id", "chunk_config", "description", "people_count"):
        assert field in hit, field
    assert hit["video_url"] == URL_A


def test_a_chunk_without_people_is_not_a_candidate_in_a_people_search(chunk_store):
    """Omitted rather than written empty: the empty aisle should be absent from
    the people space, not merely rank low in it."""
    index(chunk_store, chunks=shopper_chunks())
    returned = {hit["chunk_id"] for hit in chunk_store.search("anybody", field="people", limit=10)}
    assert 2 not in returned


def test_searching_an_unknown_vector_space_is_rejected(chunk_store):
    with pytest.raises(ValueError, match="Unknown vector field"):
        chunk_store.search("anything", field="vibes")


def test_every_declared_vector_space_is_searchable(chunk_store):
    from videomind.vectordb.render import VECTOR_FIELDS

    index(chunk_store, chunks=shopper_chunks())
    for field in VECTOR_FIELDS:
        chunk_store.search("a man with a trolley", field=field, limit=1)


def test_a_search_scoped_to_one_recording_excludes_the_other(chunk_store):
    index(chunk_store, video_id=VIDEO_A, url=URL_A, chunks=shopper_chunks())
    index(chunk_store, video_id=VIDEO_B, url=URL_B, chunks=shopper_chunks())

    both = chunk_store.search("trolley", limit=10)
    scoped = chunk_store.search("trolley", limit=10, video_ids=[VIDEO_A])

    assert {hit["video_id"] for hit in both} == {VIDEO_A, VIDEO_B}
    assert {hit["video_id"] for hit in scoped} == {VIDEO_A}


def test_a_search_scoped_to_one_analyzer_excludes_the_other(chunk_store):
    index(chunk_store, analyzer="default_video", chunks=shopper_chunks())
    index(chunk_store, analyzer="people", chunks=shopper_chunks())

    scoped = chunk_store.search("trolley", limit=10, analyzer_ids=["people"])
    assert {hit["extractor_id"] for hit in scoped} == {"people"}


def test_two_chunk_configurations_coexist(chunk_store):
    """Indexing the same recording finely must not overwrite the coarse pass."""
    coarse = [indexable(0, 0.0, 30.0, scene("a man in a red jacket pushes a trolley"))]
    fine = shopper_chunks()

    index(chunk_store, config="audio_video:5-20", chunks=fine)
    index(chunk_store, config="audio_video:20-40", chunks=coarse)

    assert chunk_store.count() == 4


def test_a_search_can_be_scoped_to_one_chunking(chunk_store):
    coarse = [indexable(0, 0.0, 30.0, scene("a man in a red jacket pushes a trolley"))]
    index(chunk_store, config="audio_video:5-20", chunks=shopper_chunks())
    index(chunk_store, config="audio_video:20-40", chunks=coarse)

    hits = chunk_store.search("trolley", limit=10, chunk_config="audio_video:20-40")
    assert hits and {hit["chunk_config"] for hit in hits} == {"audio_video:20-40"}


def test_a_time_window_excludes_moments_outside_it(chunk_store):
    index(chunk_store, chunks=shopper_chunks())

    unrestricted = chunk_store.search("empty aisle", limit=10)
    restricted = chunk_store.search("empty aisle", limit=10, before=20.0)

    assert 2 in {hit["chunk_id"] for hit in unrestricted}
    assert all(hit["end"] <= 20.0 for hit in restricted)


def test_an_object_filter_keeps_only_matching_chunks(chunk_store):
    index(chunk_store, chunks=shopper_chunks())
    hits = chunk_store.search("anything at all", limit=10, objects=["shelf"])
    assert {hit["chunk_id"] for hit in hits} == {1}


def test_a_person_count_filter_answers_what_similarity_cannot(chunk_store):
    """A description listing two people reads much the same to a vector as one
    listing one, which is why the count is a payload field and not a query."""
    index(chunk_store, chunks=shopper_chunks())
    hits = chunk_store.search("people in the aisle", limit=10, min_people=2)
    assert {hit["chunk_id"] for hit in hits} == {1}


def test_filters_compose(chunk_store):
    index(chunk_store, chunks=shopper_chunks())
    hits = chunk_store.search(
        "people in the aisle", limit=10, min_people=1, before=10.0
    )
    assert {hit["chunk_id"] for hit in hits} == {0}


def test_an_unknown_filter_reaches_the_caller_as_an_error(chunk_store):
    """The validation is in the store, so it holds however the search was
    reached -- API, agent or script."""
    index(chunk_store, chunks=shopper_chunks())
    with pytest.raises(ValueError, match="Unknown filter"):
        chunk_store.search("anything", limit=10, colour="red")


def test_a_score_threshold_suppresses_the_nearest_neighbours(chunk_store):
    """Cosine similarity always ranks *something*. The threshold is what makes
    "not in this footage" expressible at all."""
    index(chunk_store, chunks=shopper_chunks())

    assert chunk_store.search("helicopter landing on a runway", limit=5) != []
    assert chunk_store.search(
        "helicopter landing on a runway", limit=5, score_threshold=0.9
    ) == []


def test_a_threshold_does_not_suppress_content_that_is_present(chunk_store):
    index(chunk_store, chunks=shopper_chunks())
    hits = chunk_store.search("a man in a red jacket pushes a trolley",
                              limit=5, score_threshold=0.5)
    assert hits and hits[0]["chunk_id"] == 0


def test_limit_bounds_the_result_set(chunk_store):
    index(chunk_store, chunks=shopper_chunks())
    assert len(chunk_store.search("aisle", limit=2)) <= 2


def test_results_are_ranked_by_score(chunk_store):
    index(chunk_store, chunks=shopper_chunks())
    scores = [hit["score"] for hit in chunk_store.search("aisle", limit=10)]
    assert scores == sorted(scores, reverse=True)


def test_deleting_by_recording_alone_removes_all_of_it(chunk_store):
    index(chunk_store, video_id=VIDEO_A, chunks=shopper_chunks())
    index(chunk_store, video_id=VIDEO_B, url=URL_B, chunks=shopper_chunks())

    chunk_store.delete_video(VIDEO_A)

    assert chunk_store.count() == 3
    assert {h["video_id"] for h in chunk_store.search("aisle", limit=10)} == {VIDEO_B}


def test_re_running_one_analyzer_preserves_the_others(chunk_store):
    """The AT-15 case. Deleting by recording alone would wipe every other
    analyzer's work, so adding one analyzer to an existing recording would
    silently discard the rest."""
    index(chunk_store, analyzer="default_video", chunks=shopper_chunks())
    index(chunk_store, analyzer="people", chunks=shopper_chunks())

    chunk_store.delete_video(VIDEO_A, extractor_id="people")

    remaining = {hit["extractor_id"] for hit in chunk_store.search("aisle", limit=10)}
    assert remaining == {"default_video"}
    assert chunk_store.count() == 3


def test_deletion_can_be_scoped_to_one_chunking(chunk_store):
    """Re-indexing at a new depth must not take the old depth with it."""
    coarse = [indexable(0, 0.0, 30.0, scene("a man in a red jacket pushes a trolley"))]
    index(chunk_store, config="audio_video:5-20", chunks=shopper_chunks())
    index(chunk_store, config="audio_video:20-40", chunks=coarse)

    chunk_store.delete_video(VIDEO_A, chunk_config="audio_video:20-40")

    configs = {hit["chunk_config"] for hit in chunk_store.search("aisle", limit=10)}
    assert configs == {"audio_video:5-20"}


def test_deleting_a_recording_that_was_never_indexed_is_harmless(chunk_store):
    index(chunk_store, chunks=shopper_chunks())
    chunk_store.delete_video("0000000000000000")
    assert chunk_store.count() == 3
