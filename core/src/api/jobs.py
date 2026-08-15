import threading
import traceback
import uuid
from datetime import datetime, timezone

_jobs: dict[str, dict] = {}
_lock = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def create() -> str:
    job_id = uuid.uuid4().hex[:12]
    with _lock:
        _jobs[job_id] = {
            "job_id": job_id,
            "status": "queued",
            "stage": None,
            "detail": {},
            "result": None,
            "error": None,
            "created_at": _now(),
            "updated_at": _now(),
        }
    return job_id


def update(job_id: str, **changes) -> None:
    with _lock:
        if job_id in _jobs:
            _jobs[job_id].update(changes, updated_at=_now())


def get(job_id: str) -> dict | None:
    with _lock:
        job = _jobs.get(job_id)
        return dict(job) if job else None


def all_jobs() -> list[dict]:
    with _lock:
        return [dict(j) for j in _jobs.values()]


def run_in_background(job_id: str, fn, *args, **kwargs) -> None:
    """Run `fn` on a worker thread, recording progress and outcome on the job.

    Ingest takes minutes - a 5-minute video needs ~110s for detectors alone
    before any VLM calls - so the request cannot hold the connection open.
    """

    def progress(stage, detail):
        update(job_id, status="running", stage=stage, detail=detail)

    def target():
        update(job_id, status="running", stage="starting")
        try:
            result = fn(*args, progress=progress, **kwargs)
            update(job_id, status="done", stage="complete", result=result)
        except Exception as exc:
            update(
                job_id,
                status="failed",
                error=f"{type(exc).__name__}: {exc}",
                detail={"traceback": traceback.format_exc()[-2000:]},
            )

    threading.Thread(target=target, daemon=True).start()
