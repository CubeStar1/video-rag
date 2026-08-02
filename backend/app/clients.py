"""Shared VideoDB and Supabase clients.

Every video lives in the account's default collection. Project scoping is done in
Supabase — callers pass explicit VideoDB video ids and the services fan out over
them — because `create_collection()` is plan-gated on free accounts.
"""

import logging
import os
from functools import lru_cache
from typing import Any

import videodb
from videodb.collection import Collection
from videodb.video import Video

from app.config import get_settings

logger = logging.getLogger(__name__)


@lru_cache
def get_connection():
    settings = get_settings()
    if not settings.video_db_api_key:
        raise RuntimeError("VIDEO_DB_API_KEY is not set")
    # videodb.connect() reads the env var; set it so the SDK and any sub-calls agree.
    os.environ.setdefault("VIDEO_DB_API_KEY", settings.video_db_api_key)
    return videodb.connect(api_key=settings.video_db_api_key)


@lru_cache
def get_collection() -> Collection:
    return get_connection().get_collection()


def get_video(video_id: str) -> Video:
    return get_collection().get_video(video_id)


@lru_cache
def get_supabase():
    """Service-role client. Bypasses RLS so background jobs can write status."""
    from supabase import create_client

    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set")
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def update_video_row(db_video_id: str, payload: dict[str, Any]) -> None:
    """Best-effort status writeback. Never let a Supabase hiccup kill a job."""
    try:
        get_supabase().table("videos").update(payload).eq("id", db_video_id).execute()
    except Exception:  # noqa: BLE001 - status writeback is advisory
        logger.exception("Failed to update videos row %s", db_video_id)
