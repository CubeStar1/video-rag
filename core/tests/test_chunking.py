"""Chunking, exercised on synthetic boundary events rather than on footage.

`fuse` is the piece the whole pipeline rests on and the piece with no model in
it, so it can be tested exactly. AT-16 -- silent, cut-free footage must yield
multiple usable chunks rather than one span -- is a property of weight
redistribution, which is checked here directly rather than inferred from a clip.
"""

import pytest

from src.chunk import _merge_short_chunks, _split_long_chunks, chunk_video
from src.chunking import WEIGHTS, boundaries_to_chunks, fuse

DURATION = 60.0


def strong(*times):
    """Boundary events at full strength."""
    return [(t, 1.0) for t in times]


def test_a_single_active_signal_still_produces_boundaries():
    """The AT-16 case in miniature: fixed-camera footage has no cuts and no
    speech, so only one detector fires. Without redistribution that signal keeps
    the small absolute weight the preset gave it, falls under the threshold, and
    the whole recording comes back as one chunk."""
    events = {
        "speaker": [],
        "silence": [],
        "cut": [],
        "semantic": strong(15.0, 30.0, 45.0),
    }
    boundaries = fuse(events, WEIGHTS["audio"], DURATION)
    assert len(boundaries) >= 3


def test_presets_agree_when_only_one_signal_fired():
    """A preset must express *which* signals matter, not how many chunks to
    make. On single-signal footage `audio` and `video` produced 12 vs 63
    boundaries from identical content before renormalising."""
    events = {"speaker": [], "silence": [], "cut": [], "semantic": strong(20.0, 40.0)}

    audio = fuse(events, WEIGHTS["audio"], DURATION)
    video = fuse(events, WEIGHTS["video"], DURATION)
    both = fuse(events, WEIGHTS["audio_video"], DURATION)

    assert audio == video == both


def test_presets_diverge_when_the_distinguishing_signals_are_present():
    """The corollary: redistribution must not flatten a preset into a no-op when
    the signals it weights differently actually fired."""
    events = {
        "speaker": strong(10.0),
        "silence": [],
        "cut": strong(35.0),
        "semantic": [],
    }
    audio = fuse(events, WEIGHTS["audio"], DURATION, threshold=0.30)
    video = fuse(events, WEIGHTS["video"], DURATION, threshold=0.30)
    assert audio != video


def test_no_events_at_all_yields_no_boundaries():
    events = {"speaker": [], "silence": [], "cut": [], "semantic": []}
    assert fuse(events, WEIGHTS["audio_video"], DURATION) == []


def test_boundaries_are_sorted_and_inside_the_recording():
    events = {"speaker": strong(12.0), "silence": strong(28.0),
              "cut": strong(41.0), "semantic": strong(50.0)}
    boundaries = fuse(events, WEIGHTS["audio_video"], DURATION)

    assert boundaries == sorted(boundaries)
    assert all(0.0 <= t <= DURATION for t in boundaries)


def test_min_gap_is_enforced_between_accepted_boundaries():
    """Otherwise agreeing detectors produce a burst of back-to-back tiny chunks."""
    events = {"speaker": strong(20.0, 20.4, 20.8, 21.2),
              "silence": [], "cut": [], "semantic": []}
    boundaries = fuse(events, WEIGHTS["audio"], DURATION, min_gap=2.0)

    assert all(b - a >= 2.0 for a, b in zip(boundaries, boundaries[1:]))


def test_agreeing_detectors_reinforce_the_same_moment():
    """Four detectors pointing at one time must not be four boundaries."""
    events = {source: strong(30.0) for source in ("speaker", "silence", "cut", "semantic")}
    boundaries = fuse(events, WEIGHTS["audio_video"], DURATION)

    assert len(boundaries) == 1
    assert boundaries[0] == pytest.approx(30.0, abs=1.0)


def test_a_higher_threshold_accepts_fewer_boundaries():
    events = {"speaker": strong(10.0, 25.0, 40.0), "silence": [], "cut": [], "semantic": []}
    lenient = fuse(events, WEIGHTS["audio"], DURATION, threshold=0.05)
    strict = fuse(events, WEIGHTS["audio"], DURATION, threshold=0.9)
    assert len(strict) <= len(lenient)


def test_fusion_is_deterministic():
    """A re-run on a later build has to be comparable, which it is not if the
    same input can produce two answers."""
    events = {"speaker": strong(11.0), "silence": strong(22.0),
              "cut": strong(33.0), "semantic": strong(44.0)}
    first = fuse(events, WEIGHTS["audio_video"], DURATION)
    second = fuse(events, WEIGHTS["audio_video"], DURATION)
    assert first == second


def test_chunks_cover_the_recording_without_gaps_or_overlap():
    chunks = boundaries_to_chunks([10.0, 25.0], DURATION)
    assert chunks[0][0] == 0.0
    assert chunks[-1][1] == DURATION
    assert all(a[1] == b[0] for a, b in zip(chunks, chunks[1:]))


def test_no_boundaries_gives_exactly_one_chunk():
    assert boundaries_to_chunks([], DURATION) == [(0.0, DURATION)]


def test_long_chunks_split_into_equal_parts_under_the_maximum():
    parts = _split_long_chunks([(0.0, 50.0)], max_duration=20.0)
    assert len(parts) == 3
    assert all(end - start <= 20.0 + 1e-9 for start, end in parts)
    lengths = {round(end - start, 6) for start, end in parts}
    assert len(lengths) == 1


def test_splitting_preserves_the_span():
    parts = _split_long_chunks([(5.0, 47.0)], max_duration=10.0)
    assert parts[0][0] == 5.0
    assert parts[-1][1] == pytest.approx(47.0)


def test_a_chunk_already_short_enough_is_untouched():
    assert _split_long_chunks([(0.0, 8.0)], max_duration=20.0) == [(0.0, 8.0)]


def test_short_chunks_merge_forward_to_reach_the_minimum():
    merged = _merge_short_chunks([(0.0, 1.0), (1.0, 2.0), (2.0, 9.0)], min_duration=5.0)
    assert all(end - start >= 5.0 for start, end in merged)


def test_a_short_tail_folds_into_the_previous_chunk():
    """A one-second chunk at the end is not worth indexing on its own."""
    merged = _merge_short_chunks([(0.0, 10.0), (10.0, 20.0), (20.0, 21.0)], min_duration=5.0)
    assert merged[-1] == (10.0, 21.0)
    assert all(end - start >= 5.0 for start, end in merged)


def test_merging_preserves_coverage():
    chunks = [(0.0, 1.0), (1.0, 3.0), (3.0, 12.0), (12.0, 13.0)]
    merged = _merge_short_chunks(chunks, min_duration=5.0)
    assert merged[0][0] == 0.0
    assert merged[-1][1] == 13.0
    assert all(a[1] == b[0] for a, b in zip(merged, merged[1:]))


def test_merging_an_empty_list_is_not_an_error():
    assert _merge_short_chunks([], min_duration=5.0) == []


def test_interval_must_be_positive():
    with pytest.raises(ValueError, match="interval must be > 0"):
        chunk_video("unused.mp4", interval=0)


def test_min_duration_cannot_exceed_max_duration():
    with pytest.raises(ValueError, match="must be <= max_duration"):
        chunk_video("unused.mp4", preset="audio_video", min_duration=30.0, max_duration=10.0)


def test_unknown_preset_names_the_valid_ones():
    with pytest.raises(ValueError, match="Unknown preset"):
        chunk_video("unused.mp4", preset="cinematic")


def test_unknown_weight_signal_is_rejected():
    with pytest.raises(ValueError, match="Unknown signal"):
        chunk_video("unused.mp4", weights={"speaker": 1.0, "vibes": 0.5})


def test_weights_must_include_something_above_zero():
    with pytest.raises(ValueError, match="at least one signal above zero"):
        chunk_video("unused.mp4", weights={"speaker": 0.0, "cut": 0.0})


def test_every_preset_weights_every_signal():
    from src.chunk import SIGNALS

    for name, weights in WEIGHTS.items():
        assert set(weights) == set(SIGNALS), f"preset {name} is missing a signal"
        assert sum(weights.values()) == pytest.approx(1.0)
