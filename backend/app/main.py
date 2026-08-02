import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import retrieval, videos
from app.schemas import HealthResponse

logging.basicConfig(level=logging.INFO)

settings = get_settings()

app = FastAPI(
    title="Video RAG API",
    description="VideoDB-backed ingestion and retrieval for the video chat frontend.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(videos.router)
app.include_router(retrieval.router)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    from app.clients import get_collection, get_supabase

    try:
        get_collection()
        videodb_status = "ok"
    except Exception as exc:  # noqa: BLE001
        videodb_status = f"error: {exc}"

    try:
        get_supabase()
        supabase_status = "ok"
    except Exception as exc:  # noqa: BLE001
        supabase_status = f"error: {exc}"

    healthy = videodb_status == "ok" and supabase_status == "ok"
    return HealthResponse(
        status="ok" if healthy else "degraded",
        videodb=videodb_status,
        supabase=supabase_status,
    )
