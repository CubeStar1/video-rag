from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class ShotOut(BaseModel):
    """A retrieved moment, normalised across every retrieval method."""

    video_id: str
    video_title: Optional[str] = None
    start: float
    end: float
    text: Optional[str] = None
    score: Optional[float] = None
    stream_url: Optional[str] = None
    player_url: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None


class IngestRequest(BaseModel):
    db_video_id: str = Field(description="Supabase videos.id — used for status writeback")
    source_url: str
    title: Optional[str] = None


class IngestResponse(BaseModel):
    videodb_video_id: str
    collection_id: str
    title: Optional[str] = None
    duration: Optional[float] = None
    thumbnail_url: Optional[str] = None
    stream_url: Optional[str] = None
    player_url: Optional[str] = None
    status: str


class IndexEntry(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None
    record_count: Optional[int] = None
    use_for: Optional[list[str]] = None


class AnalyzerEntry(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None


class VideoStatusResponse(BaseModel):
    videodb_video_id: str
    status: str
    step: Optional[str] = None
    message: Optional[str] = None
    analyzers: list[AnalyzerEntry] = []
    indexes: list[IndexEntry] = []


class VideoDetailResponse(BaseModel):
    videodb_video_id: str
    title: Optional[str] = None
    duration: Optional[float] = None
    thumbnail_url: Optional[str] = None
    stream_url: Optional[str] = None
    player_url: Optional[str] = None
    indexes: list[IndexEntry] = []


class TranscriptResponse(BaseModel):
    videodb_video_id: str
    start: Optional[float] = None
    end: Optional[float] = None
    text: str


class SearchRequest(BaseModel):
    video_ids: list[str]
    query: str
    top_k: int = 8
    return_fields: Optional[Any] = None


class SearchResponseOut(BaseModel):
    query: str
    shots: list[ShotOut] = []
    compiled_stream_url: Optional[str] = None
    compiled_player_url: Optional[str] = None
    errors: list[str] = []


class AskRequest(BaseModel):
    video_ids: list[str]
    question: str
    top_k: int = 12


class AskResponseOut(BaseModel):
    question: str
    answer: str
    sources: list[ShotOut] = []
    errors: list[str] = []


class SemanticSearchRequest(BaseModel):
    video_ids: list[str]
    query: str
    index_names: Optional[list[str]] = None
    top_k: int = 8
    score_threshold: Optional[float] = None


class QueryRequest(BaseModel):
    video_id: str
    index_name: str
    filter: Optional[Any] = None
    limit: int = 50
    sort: Optional[list[tuple[str, str]]] = None


class AggregateRequest(BaseModel):
    video_id: str
    index_name: str
    group_by: Optional[str] = None
    metric: str = "count"
    filter: Optional[Any] = None
    limit: int = 50


class AggregateResponseOut(BaseModel):
    index_name: str
    group_by: Optional[str] = None
    metric: str
    rows: list[dict[str, Any]] = []


class ClipRequest(BaseModel):
    video_id: str
    timestamps: list[tuple[float, float]]


class ClipResponse(BaseModel):
    video_id: str
    stream_url: str
    player_url: str
    timestamps: list[tuple[float, float]]


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    videodb: str
    supabase: str
