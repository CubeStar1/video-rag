from .base import AggregateContext, Aggregator
from .chapters import ChaptersAggregator
from .entities import CooccurrenceAggregator, EntityAggregator, EntityTimelineAggregator
from .events import EventsAggregator
from .object_entities import ObjectEntityAggregator
from .ner import NERAggregator
from .novelty import NoveltyAggregator
from .sentiment import SentimentAggregator
from .speakers import SpeakerStatsAggregator
from .stats import StatsAggregator
from .summary import SummaryAggregator

REGISTRY: dict[str, Aggregator] = {
    a.id: a
    for a in (
        StatsAggregator(),
        NoveltyAggregator(),
        SpeakerStatsAggregator(),
        SummaryAggregator(),
        ChaptersAggregator(),
        EventsAggregator(),
        NERAggregator(),
        SentimentAggregator(),
        EntityAggregator(),
        ObjectEntityAggregator(),
        EntityTimelineAggregator(),
        CooccurrenceAggregator(),
    )
}

USES_LLM = frozenset({"summary", "chapters", "events", "entities", "object_entities"})


def get(aggregator_id: str) -> Aggregator:
    if aggregator_id not in REGISTRY:
        raise KeyError(f"Unknown aggregator {aggregator_id!r}; registered: {sorted(REGISTRY)}")
    return REGISTRY[aggregator_id]


def available() -> list[str]:
    return sorted(REGISTRY)


def resolve_order(aggregator_ids, analyzers) -> list[str]:
    """Order the requested aggregators so dependencies run first.

    Dependencies naming an analyzer are requirements on the video; those naming
    another aggregator pull it in. An aggregator whose analyzer is missing is
    dropped rather than run against nothing.
    """
    requested = list(aggregator_ids)
    for name in requested:
        get(name)

    available_analyzers = set(analyzers)
    ordered: list[str] = []
    visiting: set[str] = set()

    def visit(name: str, chain: tuple[str, ...] = ()) -> bool:
        if name in ordered:
            return True
        if name in visiting:
            raise ValueError(f"Circular aggregator dependency: {' -> '.join(chain + (name,))}")
        aggregator = get(name)
        visiting.add(name)
        try:
            for dependency in aggregator.depends_on:
                if dependency in REGISTRY:
                    if not visit(dependency, chain + (name,)):
                        return False
                elif dependency not in available_analyzers:
                    return False
        finally:
            visiting.discard(name)
        ordered.append(name)
        return True

    for name in requested:
        visit(name)
    return ordered


__all__ = [
    "Aggregator", "AggregateContext", "REGISTRY", "USES_LLM",
    "get", "available", "resolve_order",
]
