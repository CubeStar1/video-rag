"""Readable console logging.

The indexing pipeline runs for tens of minutes in the background, so its lines are
the ones worth reading — everything the HTTP and SDK layers narrate along the way is
noise. This keeps our loggers at INFO and pushes the chatty third parties to WARNING.
"""

import logging

LOG_FORMAT = "%(asctime)s %(levelname)-7s %(name)-22s %(message)s"
DATE_FORMAT = "%H:%M:%S"

# These log a line per HTTP request — one video ingest would bury itself in them.
NOISY_LOGGERS = (
    "httpx",
    "httpcore",
    "urllib3",
    "hpack",
    "videodb",
    "supabase",
    "storage3",
    "postgrest",
    "hpack.hpack",
)


def configure_logging(level: str = "INFO") -> None:
    """Install the root handler. Safe to call once at import time."""
    resolved = getattr(logging, level.upper(), logging.INFO)

    # force=True because uvicorn may already have installed a root handler, and
    # basicConfig is otherwise a silent no-op. It only replaces root handlers, so
    # uvicorn's own access/error loggers keep theirs.
    logging.basicConfig(level=resolved, format=LOG_FORMAT, datefmt=DATE_FORMAT, force=True)

    for name in NOISY_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)
