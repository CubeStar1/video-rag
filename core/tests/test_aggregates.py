"""Aggregate caching, staleness and failure isolation.

AT-38: cached aggregates return with no re-analysis and no model spend, and a
change to the analyzer set invalidates them. The aggregators themselves are
replaced with counting stand-ins -- what is under test is the caching policy
around them, not what a summary says.
"""

import json

import pytest

from videomind import aggregators
from videomind.api import core as api_core


class CountingAggregator:
    """Records how many times it was actually asked to do the work."""

    depends_on = ()

    def __init__(self, aggregator_id, depends_on=(), result=None, fails=False):
        self.id = aggregator_id
        self.depends_on = depends_on
        self._result = {"value": aggregator_id} if result is None else result
        self._fails = fails
        self.calls = 0

    def aggregate(self, ctx):
        self.calls += 1
        if self._fails:
            raise RuntimeError("model provider is down")
        return self._result


@pytest.fixture
def only(monkeypatch):
    """Replace the registry with exactly the given aggregators."""

    def install(*instances):
        monkeypatch.setattr(
            aggregators, "REGISTRY", {a.id: a for a in instances}, raising=True
        )
        return {a.id: a for a in instances}

    return install


@pytest.fixture
def run(record_on_disk, chunk_store):
    """`run_aggregators` bound to the on-disk record and a store that needs no model."""

    def call(**kwargs):
        return api_core.run_aggregators(
            record_on_disk["video_id"], chunk_store=chunk_store, **kwargs
        )

    return call


def stored_record(video_id):
    return json.loads((api_core.RECORDS_DIR / f"{video_id}.json").read_text(encoding="utf-8"))


def test_an_aggregator_runs_on_the_first_pass(only, run):
    registry = only(CountingAggregator("stats"))
    result = run(aggregator_ids=["stats"])

    assert registry["stats"].calls == 1
    assert result["ran"] == ["stats"]


def test_a_second_pass_reuses_the_stored_result(only, run):
    """Four of these bill an API call per run; re-uploading a recording to add
    one analyzer must not re-buy its summary."""
    registry = only(CountingAggregator("stats"))
    run(aggregator_ids=["stats"])
    result = run(aggregator_ids=["stats"])

    assert registry["stats"].calls == 1
    assert result["reused"] == ["stats"]
    assert result["ran"] == []


def test_force_recomputes_a_cached_result(only, run):
    registry = only(CountingAggregator("stats"))
    run(aggregator_ids=["stats"])
    result = run(aggregator_ids=["stats"], force=True)

    assert registry["stats"].calls == 2
    assert result["ran"] == ["stats"]


def test_reuse_is_reported_as_billed_calls_avoided(only, run, monkeypatch):
    """The saving has to be observable, or NFR-7 is an assertion rather than a
    measurement."""
    monkeypatch.setattr(aggregators, "USES_LLM", frozenset({"summary"}))
    only(CountingAggregator("summary"), CountingAggregator("stats"))

    run(aggregator_ids=["summary", "stats"])
    result = run(aggregator_ids=["summary", "stats"])

    assert result["llm_calls_saved"] == ["summary"]


def test_results_survive_between_calls(only, run, record_on_disk):
    only(CountingAggregator("stats", result={"busiest": 12.5}))
    run(aggregator_ids=["stats"])

    stored = api_core.get_aggregates(record_on_disk["video_id"], "stats")
    assert stored["result"] == {"busiest": 12.5}


def test_adding_an_analyzer_invalidates_every_aggregate(only, run, record_on_disk):
    """A summary written before `people` ran describes a recording it could not
    see people in. Serving it afterwards is a confidently outdated answer."""
    registry = only(CountingAggregator("stats"))
    run(aggregator_ids=["stats"])

    record = stored_record(record_on_disk["video_id"])
    record["analyzers"] = ["default_video", "people", "ocr"]
    (api_core.RECORDS_DIR / f"{record_on_disk['video_id']}.json").write_text(
        json.dumps(record), encoding="utf-8"
    )

    result = run(aggregator_ids=["stats"])
    assert result["recomputed_because_analyzers_changed"] is True
    assert registry["stats"].calls == 2


def test_an_unchanged_analyzer_set_is_not_stale(only, run):
    only(CountingAggregator("stats"))
    run(aggregator_ids=["stats"])
    assert run(aggregator_ids=["stats"])["recomputed_because_analyzers_changed"] is False


def test_the_analyzer_set_is_recorded_alongside_the_aggregates(only, run, record_on_disk):
    only(CountingAggregator("stats"))
    run(aggregator_ids=["stats"])
    assert stored_record(record_on_disk["video_id"])["aggregates_analyzers"] == \
        ["default_video", "people"]


def test_an_aggregator_whose_analyzer_is_missing_is_skipped(only, run):
    registry = only(
        CountingAggregator("stats"),
        CountingAggregator("speech_mood", depends_on=("diarization",)),
    )
    result = run(aggregator_ids=["stats", "speech_mood"])

    assert result["skipped"] == ["speech_mood"]
    assert registry["speech_mood"].calls == 0


def test_dependencies_run_before_dependants(only, run):
    only(
        CountingAggregator("entities", depends_on=("people",)),
        CountingAggregator("timelines", depends_on=("entities",)),
    )
    result = run(aggregator_ids=["timelines"])
    assert result["ran"] == ["entities", "timelines"]


def test_a_dependant_sees_what_its_dependency_produced(only, run):
    seen = {}

    class Reader:
        id = "reader"
        depends_on = ("producer",)

        def aggregate(self, ctx):
            seen.update(ctx.results)
            return {"ok": True}

    only(CountingAggregator("producer", result={"n": 7}), Reader())
    run(aggregator_ids=["reader"])
    assert seen["producer"] == {"n": 7}


def test_one_aggregator_failing_does_not_lose_the_others_work(only, run):
    """Twelve passes, four of them billed: a failure in the eleventh must not
    discard the ten that succeeded."""
    only(
        CountingAggregator("stats"),
        CountingAggregator("summary", fails=True),
        CountingAggregator("novelty"),
    )
    result = run(aggregator_ids=["stats", "summary", "novelty"])

    assert set(result["ran"]) == {"stats", "novelty"}
    assert "summary" in result["failed"]
    assert "RuntimeError" in result["failed"]["summary"]


def test_a_failure_is_not_cached_as_a_result(only, run):
    """Otherwise a transient provider outage becomes a permanently missing
    aggregate that only `force` can clear."""
    registry = only(CountingAggregator("summary", fails=True))
    run(aggregator_ids=["summary"])
    run(aggregator_ids=["summary"])
    assert registry["summary"].calls == 2


def test_an_aggregator_returning_nothing_is_not_recorded_as_ran(only, run):
    """An aggregator whose inputs are present but empty returns None rather than
    an empty result, and None is not something to cache and serve."""

    class Quiet:
        id = "quiet"
        depends_on = ()

        def aggregate(self, ctx):
            return None

    only(Quiet())
    result = run(aggregator_ids=["quiet"])

    assert result["ran"] == []
    assert result["aggregates"] == []


def test_requesting_an_aggregate_the_recording_lacks_says_what_it_has(record_on_disk):
    with pytest.raises(ValueError, match="has no 'summary' aggregate"):
        api_core.get_aggregates(record_on_disk["video_id"], "summary")


def test_aggregates_for_an_unknown_recording_are_not_found():
    assert api_core.get_aggregates("0000000000000000") is None


def test_running_against_an_unknown_recording_is_an_error(chunk_store):
    with pytest.raises(ValueError, match="No such video"):
        api_core.run_aggregators("0000000000000000", chunk_store=chunk_store)
