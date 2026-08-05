"""The browser UI, kept separate from the API.

Mounted only when wanted, so the backend can run headless - as a service
behind another frontend, or for an MCP client that has no use for HTML.
Controlled by VIDEOMIND_UI=0, an environment variable rather than an argument
because `uvicorn videomind.api.app:app` builds the app with no way to pass one.
"""

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
