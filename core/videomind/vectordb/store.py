import hashlib
import uuid
import warnings

from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    FieldCondition,
    Filter,
    MatchAny,
    MatchValue,
    PointStruct,
    Range,
    VectorParams,
)

from ..paths import VECTOR_DIR, ensure as ensure_dirs
from .embedder import DEFAULT_MODEL, get_embedder
from .render import VECTOR_FIELDS

COLLECTION = "chunks"

INDEXED_FIELDS = {
    "video_id": "keyword",
    "extractor_id": "keyword",
    "chunk_id": "integer",
    "chunk_config": "keyword",
    "objects": "keyword",
    "tags": "keyword",
    "people": "keyword",
    "speakers": "keyword",
    "setting": "text",
    "start": "float",
    "end": "float",
    "people_count": "integer",
}


FILTER_SPEC: dict[str, dict] = {
    "video_ids":     {"key": "video_id",     "kind": "any",   "type": "list[str]"},
    "chunk_ids":     {"key": "chunk_id",     "kind": "any",   "type": "list[int]"},
    "analyzer_ids":  {"key": "extractor_id", "kind": "any",   "type": "list[str]"},
    "chunk_config":  {"key": "chunk_config", "kind": "exact", "type": "str"},
    "objects":       {"key": "objects",      "kind": "any",   "type": "list[str]"},
    "tags":          {"key": "tags",         "kind": "any",   "type": "list[str]"},
    "speakers":      {"key": "speakers",     "kind": "any",   "type": "list[str]"},
    "people":        {"key": "people",       "kind": "any",   "type": "list[str]"},
    "min_people":    {"key": "people_count", "kind": "gte",   "type": "int"},
    "max_people":    {"key": "people_count", "kind": "lte",   "type": "int"},
    "after":         {"key": "start",        "kind": "gte",   "type": "float"},
    "before":        {"key": "end",          "kind": "lte",   "type": "float"},
}


def _suggest(name: str) -> str:
    """Nearest known filter name, so a typo says what was meant."""
    import difflib

    close = difflib.get_close_matches(name, FILTER_SPEC, n=1, cutoff=0.6)
    return f"; did you mean {close[0]!r}?" if close else ""


def build_conditions(filters: dict) -> list[FieldCondition]:
    """Turn a flat filter dict into Qdrant conditions, rejecting unknown keys.

    Validation is the point: a silently ignored filter returns plausible but
    wrong results, which is far worse than an error.
    """
    conditions: list[FieldCondition] = []
    for name, value in filters.items():
        if value is None or value == []:
            continue
        spec = FILTER_SPEC.get(name)
        if spec is None:
            raise ValueError(
                f"Unknown filter {name!r}{_suggest(name)} "
                f"(known: {sorted(FILTER_SPEC)})"
            )
        key, kind = spec["key"], spec["kind"]
        if kind == "any":
            values = value if isinstance(value, (list, tuple, set)) else [value]
            conditions.append(FieldCondition(key=key, match=MatchAny(any=list(values))))
        elif kind == "exact":
            conditions.append(FieldCondition(key=key, match=MatchValue(value=value)))
        elif kind == "gte":
            conditions.append(FieldCondition(key=key, range=Range(gte=value)))
        elif kind == "lte":
            conditions.append(FieldCondition(key=key, range=Range(lte=value)))
    return conditions


def point_id(video_id: str, extractor_id: str, start: float, end: float, chunk_config: str) -> str:
    """Deterministic ID so re-ingesting the same chunk upserts instead of duplicating.

    Keyed on the time span rather than a positional index: chunk 12 of one
    chunking run is a different moment than chunk 12 of another, so a
    positional id would silently rebind a vector to the wrong timeframe.
    """
    key = f"{video_id}|{extractor_id}|{start:.3f}|{end:.3f}|{chunk_config}"
    digest = hashlib.sha1(key.encode()).hexdigest()
    return str(uuid.UUID(digest[:32]))


def config_key(
    preset: str | None,
    min_duration: float,
    max_duration: float,
    weights: dict[str, float] | None = None,
    interval: float | None = None,
) -> str:
    """Identifies which chunking scheme produced a vector, so two chunkings of
    the same video can coexist and be filtered apart.

    Custom weights are hashed into the key. Without that, two different
    weightings sharing a min/max would collide, and since point ids are derived
    from this key the second ingest would silently overwrite the first.
    """
    if interval is not None:
        return f"interval:{interval:g}"

    label = preset or "custom"
    if weights:
        digest = hashlib.sha1(
            "|".join(f"{k}={weights[k]:.4f}" for k in sorted(weights)).encode()
        ).hexdigest()[:8]
        label = f"{label}-{digest}"
    return f"{label}:{min_duration:g}-{max_duration:g}"


class ChunkStore:
    def __init__(self, path: str | None = None, model_name: str = DEFAULT_MODEL):
        ensure_dirs()
        self.client = QdrantClient(path=str(path or VECTOR_DIR))
        self.embedder = get_embedder(model_name)
        self._ensure_collection()

    def _ensure_collection(self):
        existing = {c.name for c in self.client.get_collections().collections}
        if COLLECTION not in existing:
            self.client.create_collection(
                COLLECTION,
                vectors_config={
                    field: VectorParams(size=self.embedder.dim, distance=Distance.COSINE)
                    for field in VECTOR_FIELDS
                },
            )
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", message=".*Payload indexes have no effect.*")
            for field, schema in INDEXED_FIELDS.items():
                try:
                    self.client.create_payload_index(
                        COLLECTION, field_name=field, field_schema=schema
                    )
                except Exception:
                    pass

    def add_chunks(
        self,
        video_id: str,
        video_url: str,
        chunks: list[dict],
        extractor_id: str,
        chunk_config: str,
    ) -> int:
        """Index one analyzer's output for every chunk of a video.

        Each chunk dict needs `start`, `end`, `output` (the analyzer's result)
        and `fields` ({named_vector: text}, produced by that analyzer's own
        render_fields). The store stays agnostic about analyzers so adding one
        never requires changing it. Payload carries everything needed to cite
        the moment, so retrieval never joins back to a JSON file.
        """
        points, field_maps = [], []
        for chunk in chunks:
            fields = chunk.get("fields") or {}
            if not fields.get("combined"):
                continue
            points.append(chunk)
            field_maps.append(fields)

        if not points:
            return 0

        flat = [(i, name, text) for i, fields in enumerate(field_maps) for name, text in fields.items()]
        embedded = self.embedder.embed_documents([text for _, _, text in flat])
        vectors_per_chunk: list[dict[str, list[float]]] = [{} for _ in points]
        for (i, name, _), vector in zip(flat, embedded):
            vectors_per_chunk[i][name] = vector.tolist()

        structs = []
        for chunk, fields, vectors in zip(points, field_maps, vectors_per_chunk):
            output = chunk["output"] if isinstance(chunk["output"], dict) else {}
            text = fields["combined"]
            payload = {
                "video_id": video_id,
                "video_url": video_url,
                "extractor_id": extractor_id,
                "chunk_config": chunk_config,
                "chunk_id": chunk.get("id"),
                "start": float(chunk["start"]),
                "end": float(chunk["end"]),
                "text": text,
                "description": output.get("description", text),
                "setting": output.get("setting", ""),
                "people": output.get("people", []),
                "objects": output.get("objects", []),
                "actions": output.get("actions", []),
                "tags": output.get("tags", []),
                "speakers": output.get("speakers", []),
                "turns": output.get("turns", []),
                "texts": output.get("texts", []),
                "detections": output.get("detections", []),
                "persons": output.get("people", []),
                "people_count": output.get("people_count"),
            }
            structs.append(
                PointStruct(
                    id=point_id(video_id, extractor_id, chunk["start"], chunk["end"], chunk_config),
                    vector=vectors,
                    payload=payload,
                )
            )

        self.client.upsert(COLLECTION, points=structs)
        return len(structs)

    def search(
        self,
        query: str,
        limit: int = 10,
        score_threshold: float | None = None,
        field: str = "combined",
        **filters,
    ) -> list[dict]:
        """Vector search narrowed by any combination of payload filters.

        Cosine similarity always ranks *something*, so a query for content a
        video does not contain still returns its nearest neighbours rather
        than nothing. `score_threshold` is what makes "no match" expressible.
        On this data present content scored >=0.665 and absent content <=0.524,
        so ~0.55-0.60 separates them; retune per embedding model.

        `field` picks the named vector space: "combined" (default) searches the
        whole flattened record, while "people"/"actions"/"objects"/"description"
        match against just that part. Chunks lacking the chosen field are
        naturally excluded rather than matched on empty text.
        """
        if field not in VECTOR_FIELDS:
            raise ValueError(f"Unknown vector field {field!r}; expected one of {list(VECTOR_FIELDS)}")
        must = build_conditions(filters)

        response = self.client.query_points(
            COLLECTION,
            query=self.embedder.embed_query(query).tolist(),
            using=field,
            query_filter=Filter(must=must) if must else None,
            limit=limit,
            score_threshold=score_threshold,
            with_payload=True,
        )

        return [{"score": p.score, **p.payload} for p in response.points]

    def delete_video(
        self,
        video_id: str,
        chunk_config: str | None = None,
        extractor_id: str | None = None,
    ) -> None:
        """Drop a video's vectors.

        Narrow with `chunk_config` and/or `extractor_id`. Re-ingest should
        scope to the analyzer being re-run: deleting by video alone wipes
        every *other* analyzer's vectors too, so adding one analyzer to an
        existing video would silently destroy the rest.
        """
        must = [FieldCondition(key="video_id", match=MatchValue(value=video_id))]
        if chunk_config:
            must.append(FieldCondition(key="chunk_config", match=MatchValue(value=chunk_config)))
        if extractor_id:
            must.append(FieldCondition(key="extractor_id", match=MatchValue(value=extractor_id)))
        self.client.delete(COLLECTION, points_selector=Filter(must=must))

    def count(self) -> int:
        return self.client.count(COLLECTION).count

    def close(self) -> None:
        """Release the local storage lock. Qdrant's embedded client otherwise
        closes during interpreter shutdown and logs a noisy (harmless)
        ImportError."""
        self.client.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
