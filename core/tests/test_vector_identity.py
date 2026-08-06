"""The vector key, which is what makes re-ingestion idempotent instead of destructive.

AT-13 (the same bytes are one recording) and AT-14 (two chunkings of one
recording coexist) both reduce to whether `point_id` and `config_key` separate
what must be separate and collapse what must collapse.
"""

import pytest

from videomind.vectordb.store import config_key, point_id

VIDEO = "abc123def4567890"


# --- point_id (AT-13, AT-14) --------------------------------------------------

def test_the_same_chunk_yields_the_same_id():
    """Re-ingesting upserts in place. If this varied, a second run would double
    every vector in the collection."""
    first = point_id(VIDEO, "default_video", 0.0, 10.0, "audio_video:5-20")
    second = point_id(VIDEO, "default_video", 0.0, 10.0, "audio_video:5-20")
    assert first == second


def test_the_id_is_a_uuid():
    """Qdrant accepts a UUID or an unsigned integer, nothing else."""
    import uuid

    uuid.UUID(point_id(VIDEO, "default_video", 0.0, 10.0, "audio_video:5-20"))


@pytest.mark.parametrize(
    "changed",
    [
        {"video_id": "0000000000000000"},
        {"extractor_id": "people"},
        {"start": 0.5},
        {"end": 10.5},
        {"chunk_config": "interval:10"},
    ],
)
def test_every_component_of_the_key_changes_the_id(changed):
    base = dict(video_id=VIDEO, extractor_id="default_video",
                start=0.0, end=10.0, chunk_config="audio_video:5-20")
    assert point_id(**base) != point_id(**{**base, **changed})


def test_the_key_is_the_time_span_not_a_position():
    """Chunk 12 of one chunking run is a different moment from chunk 12 of
    another. A positional id would silently rebind a vector to the wrong
    timeframe -- the search would still return a hit, just at the wrong place."""
    coarse = point_id(VIDEO, "default_video", 0.0, 20.0, "audio_video:5-20")
    fine = point_id(VIDEO, "default_video", 0.0, 10.0, "audio_video:2-10")
    assert coarse != fine


def test_ids_are_stable_across_equivalent_float_spellings():
    """`10` and `10.0` are the same moment; formatting to three decimals is what
    keeps them from becoming two points."""
    assert point_id(VIDEO, "default_video", 0, 10, "c") == \
           point_id(VIDEO, "default_video", 0.0, 10.0, "c")


def test_sub_millisecond_differences_collapse():
    assert point_id(VIDEO, "default_video", 0.0, 10.0001, "c") == \
           point_id(VIDEO, "default_video", 0.0, 10.0002, "c")


# --- config_key (AT-14) -------------------------------------------------------

def test_preset_and_bounds_are_both_in_the_key():
    assert config_key("audio_video", 5, 20) == "audio_video:5-20"


def test_different_bounds_are_different_configurations():
    """The same preset at another depth is a second indexing of the video, not
    an overwrite of the first."""
    assert config_key("audio_video", 5, 20) != config_key("audio_video", 2, 10)


def test_interval_mode_has_its_own_key_shape():
    assert config_key(None, 5, 20, interval=10) == "interval:10"


def test_interval_takes_precedence_over_the_bounds_it_ignores():
    """`interval` applies no min/max, so carrying them into the key would claim
    a constraint the chunks were never subject to."""
    assert config_key("audio_video", 5, 20, interval=10) == "interval:10"


def test_custom_weights_are_hashed_into_the_key():
    """Two weightings sharing a min/max would otherwise collide, and since point
    ids derive from this key the second ingest would overwrite the first."""
    heavy_cut = config_key(None, 5, 20, weights={"cut": 0.9, "speaker": 0.1})
    heavy_speaker = config_key(None, 5, 20, weights={"cut": 0.1, "speaker": 0.9})
    assert heavy_cut != heavy_speaker


def test_the_same_weights_hash_the_same_way():
    weights = {"cut": 0.6, "semantic": 0.4}
    assert config_key(None, 5, 20, weights=weights) == config_key(None, 5, 20, weights=dict(weights))


def test_weight_order_does_not_change_the_key():
    """Sorted before hashing: a caller's dict ordering is not a chunking scheme."""
    assert config_key(None, 5, 20, weights={"cut": 0.6, "semantic": 0.4}) == \
           config_key(None, 5, 20, weights={"semantic": 0.4, "cut": 0.6})


def test_weighted_mode_is_distinguishable_from_the_preset_it_resembles():
    assert config_key("audio_video", 5, 20) != \
           config_key("audio_video", 5, 20, weights={"cut": 0.25})


def test_a_key_without_a_preset_is_labelled_custom():
    assert config_key(None, 5, 20).startswith("custom:")


def test_fractional_bounds_survive_into_the_key():
    assert config_key("audio", 2.5, 7.5) == "audio:2.5-7.5"
