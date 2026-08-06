"""The filter declaration, which is the one place a filter is defined.

AT-25 is the case that matters here: a filter that is silently ignored returns
plausible but wrong results, which is worse than an error, because nothing about
the response says it happened.
"""

import pytest

from videomind.vectordb.store import FILTER_SPEC, INDEXED_FIELDS, build_conditions


def keys_of(conditions):
    return [c.key for c in conditions]


def test_an_unknown_filter_raises_rather_than_being_dropped():
    with pytest.raises(ValueError, match="Unknown filter"):
        build_conditions({"objects_": ["trolley"]})


def test_the_error_suggests_the_nearest_valid_name():
    """A typo should cost a reading of the message, not a debugging session."""
    with pytest.raises(ValueError, match="did you mean 'objects'"):
        build_conditions({"object": ["trolley"]})


def test_the_error_lists_every_known_filter_when_nothing_is_close():
    with pytest.raises(ValueError) as excinfo:
        build_conditions({"zzzzz": 1})
    message = str(excinfo.value)
    assert all(name in message for name in ("video_ids", "min_people", "before"))


def test_a_valid_name_is_not_reported_as_a_typo():
    build_conditions({"objects": ["trolley"]})


def test_list_filters_match_any_of_their_values():
    conditions = build_conditions({"objects": ["trolley", "shelf"]})
    assert len(conditions) == 1
    assert conditions[0].match.any == ["trolley", "shelf"]


def test_a_bare_value_is_accepted_where_a_list_is_expected():
    """Callers write `video_ids="abc"` and mean one video."""
    conditions = build_conditions({"video_ids": "abc123def4567890"})
    assert conditions[0].match.any == ["abc123def4567890"]


def test_exact_filters_match_one_value():
    conditions = build_conditions({"chunk_config": "audio_video:5-20"})
    assert conditions[0].match.value == "audio_video:5-20"


def test_numeric_bounds_become_ranges():
    lower = build_conditions({"min_people": 3})[0]
    upper = build_conditions({"max_people": 5})[0]
    assert lower.range.gte == 3
    assert upper.range.lte == 5


def test_time_bounds_map_to_the_span_they_constrain():
    """`after` bounds the chunk's start and `before` its end, so a window
    returns only chunks lying wholly inside it."""
    after = build_conditions({"after": 60.0})[0]
    before = build_conditions({"before": 120.0})[0]
    assert (after.key, after.range.gte) == ("start", 60.0)
    assert (before.key, before.range.lte) == ("end", 120.0)


def test_filters_map_onto_their_payload_fields_not_their_own_names():
    """The API name and the stored field differ on purpose; this is where the
    two are reconciled."""
    assert keys_of(build_conditions({"analyzer_ids": ["people"]})) == ["extractor_id"]
    assert keys_of(build_conditions({"min_people": 1})) == ["people_count"]


def test_none_is_not_a_filter():
    """Every caller passes the full parameter set with unused ones set to None."""
    assert build_conditions({"objects": None, "speakers": None}) == []


def test_an_empty_list_is_not_a_filter():
    """"No objects requested" must not become "match a chunk with no objects"."""
    assert build_conditions({"objects": []}) == []


def test_zero_is_a_filter():
    """`min_people=0` is falsy but meaningful, and dropping it would quietly
    widen the search."""
    conditions = build_conditions({"min_people": 0})
    assert len(conditions) == 1
    assert conditions[0].range.gte == 0


def test_an_empty_filter_dict_produces_no_conditions():
    assert build_conditions({}) == []


def test_several_filters_all_apply():
    conditions = build_conditions(
        {"video_ids": ["abc"], "objects": ["trolley"], "min_people": 2, "after": 30.0}
    )
    assert len(conditions) == 4
    assert set(keys_of(conditions)) == {"video_id", "objects", "people_count", "start"}


def test_both_ends_of_a_range_can_be_set_at_once():
    conditions = build_conditions({"min_people": 2, "max_people": 4})
    assert len(conditions) == 2
    assert all(c.key == "people_count" for c in conditions)


def test_every_filter_declares_a_key_a_kind_and_a_type():
    """`/schema` publishes all three, and an agent builds its request from them."""
    for name, spec in FILTER_SPEC.items():
        assert set(spec) >= {"key", "kind", "type"}, name
        assert spec["kind"] in {"any", "exact", "gte", "lte"}, name


def test_every_filterable_field_is_declared_as_an_index():
    """Embedded Qdrant ignores payload indexes and scans, which is correct at
    this scale. The declarations are what a Qdrant server would turn into real
    indexes with no code change -- so a filter added without one is a scan that
    never becomes an index."""
    filtered = {spec["key"] for spec in FILTER_SPEC.values()}
    assert filtered <= set(INDEXED_FIELDS), filtered - set(INDEXED_FIELDS)


def test_every_declared_filter_is_reachable():
    """The regression this guards: a hand-plumbed parameter list once left six
    store filters unreachable from the API."""
    samples = {"any": ["x"], "exact": "x", "gte": 1, "lte": 1}
    for name, spec in FILTER_SPEC.items():
        conditions = build_conditions({name: samples[spec["kind"]]})
        assert len(conditions) == 1, name
        assert conditions[0].key == spec["key"], name
