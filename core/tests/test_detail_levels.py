"""Response detail levels and record reading.

AT-26 (the three levels rank identically while the payload grows) and AT-36
(every chunk's stored record is retrievable, including the raw document).
"""

import pytest

from src.api import core as api_core

HIT = {
    "video_id": "abc123def4567890",
    "video_url": "https://example.invalid/a.mp4",
    "chunk_id": 3,
    "start": 65.0,
    "end": 78.5,
    "score": 0.7314159,
    "text": "A long flattened record " * 40,
    "description": "A man in a red jacket pushes a trolley past the checkout",
    "setting": "supermarket aisle",
    "people": ["a man in a red jacket"],
    "objects": ["trolley", "checkout"],
    "actions": ["pushing a trolley"],
    "tags": ["indoor"],
    "speakers": [],
    "turns": [],
    "people_count": 1,
    "persons": [{"description": "a man in a red jacket", "clothing": "red jacket"}],
    "detections": [{"label": "person", "confidence": 0.91}],
    "texts": [{"text": "CHECKOUT 4", "kind": "sign"}],
}


@pytest.mark.parametrize("detail", api_core.DETAIL_LEVELS)
def test_every_level_identifies_and_locates_the_moment(detail):
    """Whatever else is trimmed, a result has to remain playable and citable."""
    shaped = api_core._shape(HIT, detail)
    for field in ("video_id", "chunk_id", "start", "end", "timecode", "score"):
        assert field in shaped, field


@pytest.mark.parametrize("detail", api_core.DETAIL_LEVELS)
def test_the_same_moment_comes_back_at_every_level(detail):
    """AT-26: the levels change the payload, never the ranking or the result."""
    shaped = api_core._shape(HIT, detail)
    assert shaped["chunk_id"] == HIT["chunk_id"]
    assert (shaped["start"], shaped["end"]) == (HIT["start"], HIT["end"])


def test_the_timecode_is_human_readable():
    assert api_core._shape(HIT, "minimal")["timecode"] == "1:05.00-1:18.50"


def test_the_score_is_rounded_rather_than_carried_at_full_precision():
    assert api_core._shape(HIT, "minimal")["score"] == 0.7314


def test_minimal_carries_a_snippet_and_not_the_record():
    shaped = api_core._shape(HIT, "minimal")
    assert "snippet" in shaped
    assert "persons" not in shaped and "text" not in shaped


def test_the_snippet_is_bounded():
    """Five full hits measured ~19k tokens against ~440 at minimal; the bound is
    what an agent is actually paying for."""
    long_hit = {**HIT, "description": "x" * 500}
    snippet = api_core._shape(long_hit, "minimal")["snippet"]
    assert len(snippet) <= api_core.SNIPPET_CHARS + 3
    assert snippet.endswith("...")


def test_a_short_description_is_not_marked_as_truncated():
    short_hit = {**HIT, "description": "A short line"}
    assert api_core._shape(short_hit, "minimal")["snippet"] == "A short line"


def test_the_snippet_falls_back_to_the_flattened_record():
    """A transcript hit has no `description`; it must still say something."""
    no_description = {**HIT, "description": "", "text": "we should head back now"}
    assert api_core._shape(no_description, "minimal")["snippet"] == "we should head back now"


def test_standard_adds_the_facets_the_interface_renders():
    shaped = api_core._shape(HIT, "standard")
    for field in ("description", "people", "objects", "actions", "tags", "people_count"):
        assert field in shaped, field


def test_standard_withholds_the_flattened_record():
    """The interface renders `description`; carrying `text` as well doubles the
    response for nothing."""
    assert "text" not in api_core._shape(HIT, "standard")


def test_full_adds_the_nested_records():
    shaped = api_core._shape(HIT, "full")
    for field in ("text", "persons", "detections", "texts"):
        assert field in shaped, field


def test_the_payload_grows_monotonically_with_the_level():
    sizes = [len(str(api_core._shape(HIT, level))) for level in api_core.DETAIL_LEVELS]
    assert sizes == sorted(sizes)
    assert sizes[0] < sizes[-1]


def test_each_level_is_a_superset_of_the_one_below_except_the_snippet():
    minimal = set(api_core._shape(HIT, "minimal")) - {"snippet"}
    standard = set(api_core._shape(HIT, "standard"))
    full = set(api_core._shape(HIT, "full"))
    assert minimal <= standard <= full


def test_a_hit_missing_optional_fields_still_shapes():
    """Not every analyzer produces people or objects."""
    sparse = {k: HIT[k] for k in ("video_id", "chunk_id", "start", "end", "score", "text")}
    shaped = api_core._shape(sparse, "standard")
    assert shaped["people"] == [] and shaped["people_count"] is None


def test_a_chunk_record_is_retrievable(record_on_disk):
    chunk = api_core.get_chunk(record_on_disk["video_id"], 0)
    assert chunk["chunk_id"] == 0
    assert chunk["default_video"]["description"] == "A shopper enters the aisle"


def test_a_chunk_record_carries_every_analyzer_that_ran(record_on_disk):
    chunk = api_core.get_chunk(record_on_disk["video_id"], 0)
    assert "default_video" in chunk and "people" in chunk


def test_geometry_and_debug_keys_are_withheld_by_default(record_on_disk):
    """Per-frame box coordinates are what the entity pass needs and what an LLM
    reading chunk output gains nothing from."""
    chunk = api_core.get_chunk(record_on_disk["video_id"], 0)
    assert "locations" not in chunk["people"]
    assert "_debug" not in chunk["people"]


def test_verbose_returns_the_raw_stored_document(record_on_disk):
    """AT-36 explicitly includes the raw record, so `verbose` has to be a real
    escape hatch rather than a slightly fuller summary."""
    chunk = api_core.get_chunk(record_on_disk["video_id"], 0, verbose=True)
    assert "locations" in chunk["people"]


def test_an_unknown_chunk_is_not_found(record_on_disk):
    assert api_core.get_chunk(record_on_disk["video_id"], 99) is None


def test_an_unknown_video_is_not_found():
    assert api_core.get_chunk("0000000000000000", 0) is None


def test_chunks_can_be_scoped_to_one_analyzer(record_on_disk):
    """Chunk 1 has no `people` output, so it drops out rather than coming back
    empty."""
    page = api_core.get_chunks(record_on_disk["video_id"], analyzer_id="people")
    assert {c["chunk_id"] for c in page["chunks"]} == {0, 2}


def test_asking_for_an_analyzer_that_never_ran_is_an_error(record_on_disk):
    """Distinguishable from "it ran and found nothing", which is the whole
    point of the AT-12 behaviour one level up."""
    with pytest.raises(ValueError, match="has no 'ocr' output"):
        api_core.get_chunks(record_on_disk["video_id"], analyzer_id="ocr")


def test_a_time_window_selects_overlapping_chunks(record_on_disk):
    page = api_core.get_chunks(record_on_disk["video_id"], after=15.0)
    assert {c["chunk_id"] for c in page["chunks"]} == {1, 2}


def test_chunks_can_be_fetched_by_id_in_one_call(record_on_disk):
    """An agent holding ids from a minimal search gets them all at once rather
    than one round trip each."""
    page = api_core.get_chunks(record_on_disk["video_id"], chunk_ids=[0, 2])
    assert {c["chunk_id"] for c in page["chunks"]} == {0, 2}


def test_reads_are_bounded_so_a_caller_cannot_pull_a_whole_recording(record_on_disk):
    page = api_core.get_chunks(record_on_disk["video_id"], limit=2)
    assert len(page["chunks"]) == 2
    assert page["total"] == 3


def test_pagination_walks_the_recording(record_on_disk):
    first = api_core.get_chunks(record_on_disk["video_id"], limit=2, offset=0)
    second = api_core.get_chunks(record_on_disk["video_id"], limit=2, offset=2)
    ids = [c["chunk_id"] for c in first["chunks"] + second["chunks"]]
    assert ids == [0, 1, 2]


def test_video_metadata_reports_what_was_produced(record_on_disk):
    video = api_core.get_video(record_on_disk["video_id"])
    assert video["chunks"] == 3
    assert video["analyzers"] == ["default_video", "people"]
    assert video["chunk_config"] == "audio_video:5-20"
