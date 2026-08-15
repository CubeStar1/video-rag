import os

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse

from ..paths import STATIC_DIR

router = APIRouter()


def enabled() -> bool:
    return os.environ.get("VIDEOMIND_UI", "1").lower() not in {"0", "false", "no"}


@router.get("/", response_class=HTMLResponse, include_in_schema=False)
def index():
    page = STATIC_DIR / "index.html"
    if not page.exists():
        raise HTTPException(404, "UI not installed")
    return page.read_text(encoding="utf-8")
