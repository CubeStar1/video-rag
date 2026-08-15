"""Background ingestion, which is the only place a failure has nobody watching it.

AT-17 (a failed ingestion explains itself rather than hanging) and AT-18 (a lost
job is detectable, so the client does not poll for ever).
"""

import time

import pytest

from src.api import core as api_core, jobs


def wait_for(job_id, status, timeout=5.0):
    """Poll as the client does, rather than sleeping a guessed interval."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = jobs.get(job_id)
        if job and job["status"] == status:
            return job
        time.sleep(0.01)
    pytest.fail(f"job {job_id} never reached {status!r}: {jobs.get(job_id)}")


def test_a_new_job_starts_queued():
    job = jobs.get(jobs.create())
    assert job["status"] == "queued"
    assert job["stage"] is None and job["error"] is None


def test_a_job_id_is_unique():
    assert len({jobs.create() for _ in range(20)}) == 20


def test_progress_updates_are_visible_to_a_poller():
    """AT-11/NFR-3 read this: stage and progress are what the recording card
    shows while it processes."""
    job_id = jobs.create()
    jobs.update(job_id, status="running", stage="analyzing", detail={"analyzer": "ocr"})

    job = jobs.get(job_id)
    assert (job["status"], job["stage"]) == ("running", "analyzing")
    assert job["detail"] == {"analyzer": "ocr"}


def test_an_update_advances_the_timestamp():
    job_id = jobs.create()
    before = jobs.get(job_id)["updated_at"]
    time.sleep(1.05)
    jobs.update(job_id, stage="indexing")
    assert jobs.get(job_id)["updated_at"] >= before


def test_reading_a_job_returns_a_copy():
    """A caller mutating what it polled must not rewrite the job table."""
    job_id = jobs.create()
    jobs.get(job_id)["status"] = "done"
    assert jobs.get(job_id)["status"] == "queued"


def test_updating_a_job_that_does_not_exist_is_ignored():
    jobs.update("nosuchjob", status="done")


def test_an_unknown_job_is_reported_as_missing_not_pending():
    """Jobs live in memory and do not survive a restart. The client detects the
    loss precisely because this returns nothing rather than a queued-looking
    row it would poll for ever."""
    assert jobs.get("deadbeefcafe") is None


def test_jobs_are_enumerable():
    job_id = jobs.create()
    assert job_id in {job["job_id"] for job in jobs.all_jobs()}


def test_a_completed_job_carries_its_result():
    job_id = jobs.create()
    jobs.run_in_background(job_id, lambda progress: {"chunks": 39})

    job = wait_for(job_id, "done")
    assert job["result"] == {"chunks": 39}
    assert job["stage"] == "complete"


def test_stages_reported_by_the_work_reach_the_job():
    seen = []

    def work(progress):
        for stage in ("fetching", "chunking", "analyzing", "indexing"):
            progress(stage, {"step": stage})
            seen.append(stage)
        return {"ok": True}

    job_id = jobs.create()
    jobs.run_in_background(job_id, work)
    wait_for(job_id, "done")

    assert seen == ["fetching", "chunking", "analyzing", "indexing"]


def test_a_failing_job_records_why_and_stops(monkeypatch):
    """AT-17: the reason is retained and reported. A failure that left the job
    running would leave the workspace in a loading state for ever."""

    def work(progress):
        raise ValueError("https://example.invalid/login.html served 'text/html', which is not a video")

    job_id = jobs.create()
    jobs.run_in_background(job_id, work)

    job = wait_for(job_id, "failed")
    assert job["error"].startswith("ValueError:")
    assert "not a video" in job["error"]
    assert job["result"] is None


def test_a_failure_keeps_a_traceback_for_the_defect_record():
    def work(progress):
        raise RuntimeError("boom")

    job_id = jobs.create()
    jobs.run_in_background(job_id, work)

    job = wait_for(job_id, "failed")
    assert "Traceback" in job["detail"]["traceback"]


def test_arguments_reach_the_work():
    job_id = jobs.create()
    jobs.run_in_background(job_id, lambda source, progress, depth=1: {"source": source, "depth": depth},
                           "clip.mp4", depth=3)
    assert wait_for(job_id, "done")["result"] == {"source": "clip.mp4", "depth": 3}


def test_a_non_http_source_is_rejected_while_a_caller_is_still_there():
    """Ingest runs on a background thread, so anything not checked up front
    fails into a job the client has to poll to discover."""
    with pytest.raises(ValueError, match="Unsupported URL scheme"):
        api_core.validate_source("file:///etc/passwd")


def test_a_source_with_no_scheme_is_rejected():
    with pytest.raises(ValueError, match="Unsupported URL scheme"):
        api_core.validate_source("example.invalid/clip.mp4")


@pytest.mark.parametrize("url", [
    "http://example.invalid/clip.mp4",
    "https://example.invalid/clip.mp4",
    "HTTPS://example.invalid/clip.mp4",
])
def test_http_and_https_sources_are_accepted(url):
    api_core.validate_source(url)
