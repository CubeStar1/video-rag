"""The registries are what make "extension by registration" true rather than aspirational.

Covers AT-09 (analyzer selection is honoured), AT-10 / AT-40 (the analyzer list
is discovered, not hard-coded) and the dependency ordering that AT-38 relies on.
"""

import pytest

from videomind import aggregators, analyzers


def test_registry_key_matches_each_analyzer_id():
    """A key that disagrees with the analyzer's own id makes the registry a lie:
    `/schema` advertises the key, and the ingest path looks up by id."""
    for key, analyzer in analyzers.REGISTRY.items():
        assert key == analyzer.id


def test_every_analyzer_satisfies_the_protocol():
    """One module, three members. If this fails, adding an analyzer stopped
    being a one-file change."""
    for analyzer in analyzers.REGISTRY.values():
        assert isinstance(analyzer.id, str) and analyzer.id
        assert callable(getattr(analyzer, "analyze", None))
        assert callable(getattr(analyzer, "render_fields", None))


def test_available_is_sorted_and_complete():
    assert analyzers.available() == sorted(analyzers.REGISTRY)


def test_a_newly_registered_analyzer_needs_no_other_edit(monkeypatch):
    """AT-40: register one object, and every consumer picks it up.

    Nothing is patched except the registry itself -- if any other module held
    its own list of analyzers, the assertions below would not see this one.
    """

    class TrivialAnalyzer:
        id = "trivial"

        def analyze(self, chunks, ctx):
            return ["nothing to report" for _ in chunks]

        def render_fields(self, output):
            return {"combined": output}

    monkeypatch.setitem(analyzers.REGISTRY, "trivial", TrivialAnalyzer())

    assert "trivial" in analyzers.available()
    assert analyzers.get("trivial").id == "trivial"
    analyzers.validate_selection(["trivial"])


def test_unknown_analyzer_names_the_registered_ones():
    with pytest.raises(KeyError) as excinfo:
        analyzers.get("does_not_exist")
    assert "default_video" in str(excinfo.value)


def test_validate_selection_accepts_a_valid_subset():
    analyzers.validate_selection(["default_video", "transcript"])


def test_validate_selection_rejects_unknown_names():
    with pytest.raises(ValueError, match="Unknown analyzer"):
        analyzers.validate_selection(["default_video", "clairvoyance"])


def test_transcript_and_diarization_are_mutually_exclusive():
    """Both embed the same Whisper text -- their vectors came out cosine-
    identical -- so running both doubles cost for no retrieval gain."""
    with pytest.raises(ValueError, match="mutually exclusive"):
        analyzers.validate_selection(["transcript", "diarization"])


def test_either_of_the_exclusive_pair_alone_is_fine():
    analyzers.validate_selection(["transcript"])
    analyzers.validate_selection(["diarization"])


def test_exclusive_groups_only_name_registered_analyzers():
    for group in analyzers.EXCLUSIVE_GROUPS:
        assert group <= set(analyzers.REGISTRY)


def test_aggregator_registry_key_matches_id():
    for key, aggregator in aggregators.REGISTRY.items():
        assert key == aggregator.id


def test_every_aggregator_declares_dependencies_and_can_run():
    for aggregator in aggregators.REGISTRY.values():
        assert isinstance(aggregator.depends_on, tuple)
        assert callable(getattr(aggregator, "aggregate", None))


def test_uses_llm_only_names_registered_aggregators():
    """A stale name here would let a caller think it had avoided a billed pass."""
    assert aggregators.USES_LLM <= set(aggregators.REGISTRY)


def test_every_dependency_resolves_to_an_analyzer_or_an_aggregator():
    """A typo in `depends_on` is silent: `resolve_order` reads an unrecognised
    name as a missing analyzer and drops the aggregator without a word."""
    known = set(aggregators.REGISTRY) | set(analyzers.REGISTRY)
    for aggregator in aggregators.REGISTRY.values():
        for dependency in aggregator.depends_on:
            assert dependency in known, f"{aggregator.id} depends on unknown {dependency!r}"


def test_dependencies_run_before_their_dependants():
    order = aggregators.resolve_order(
        ["entity_timelines", "entities"], analyzers=["people"]
    )
    assert order.index("entities") < order.index("entity_timelines")


def test_a_dependency_is_pulled_in_even_when_not_requested():
    order = aggregators.resolve_order(["cooccurrence"], analyzers=["people"])
    assert order == ["entities", "cooccurrence"]


def test_an_aggregator_whose_analyzer_is_absent_is_dropped_not_run():
    """Skipped rather than failed: a video without `people` simply has no
    entities, which is not an error."""
    order = aggregators.resolve_order(["entities", "stats"], analyzers=["default_video"])
    assert order == ["stats"]


def test_a_dependant_is_dropped_when_its_dependency_is_unsatisfiable():
    order = aggregators.resolve_order(["entity_timelines"], analyzers=["default_video"])
    assert order == []


def test_aggregators_with_no_dependencies_always_run():
    order = aggregators.resolve_order(["stats", "novelty"], analyzers=[])
    assert set(order) == {"stats", "novelty"}


def test_resolve_order_validates_before_doing_any_work():
    with pytest.raises(KeyError, match="Unknown aggregator"):
        aggregators.resolve_order(["stats", "not_an_aggregator"], analyzers=[])


def test_circular_dependencies_are_reported(monkeypatch):
    class Ping:
        id = "ping"
        depends_on = ("pong",)

        def aggregate(self, ctx):
            return {}

    class Pong:
        id = "pong"
        depends_on = ("ping",)

        def aggregate(self, ctx):
            return {}

    monkeypatch.setitem(aggregators.REGISTRY, "ping", Ping())
    monkeypatch.setitem(aggregators.REGISTRY, "pong", Pong())

    with pytest.raises(ValueError, match="Circular aggregator dependency"):
        aggregators.resolve_order(["ping"], analyzers=[])
