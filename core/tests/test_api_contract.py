"""The HTTP surface, which is the only contract the client and the agent have.

AT-39 (a client can be built from the capability endpoint alone) and AT-41
(every documented endpoint exists and returns the documented shape). The Postman
collection covers these against a live server; this covers them on every change,
without a GPU or a model provider.
"""

import pytest

from videomind import aggregators, analyzers
from videomind.vectordb.render import VECTOR_FIELDS
from videomind.vectordb.store import FILTER_SPEC


# --- the capability endpoint (AT-39) ------------------------------------------

def test_schema_is_reachable(client):
    assert client.get("/schema").status_code == 200


def test_schema_describes_everything_a_request_needs(client):
    """AT-39: given only this, a caller has to be able to construct a valid
    filtered search. Anything absent here is something it would have to guess."""
    body = client.get("/schema").json()
    for section in ("analyzers", "vector_fields", "detail_levels", "filters", "aggregators"):
        assert section in body, section


def test_schema_advertises_the_registered_analyzers(client):
    """Discovered, not hard-coded. The ingest dialog builds its list from this,
    so a disagreement is AT-10 failing."""
    assert client.get("/schema").json()["analyzers"] == analyzers.available()


def test_schema_advertises_the_exclusive_groups(client):
    """A UI can only enforce the transcript/diarization rule if it is told."""
    groups = client.get("/schema").json()["exclusive_groups"]
    assert [sorted(g) for g in analyzers.EXCLUSIVE_GROUPS] == groups


def test_schema_advertises_every_vector_space(client):
    assert set(client.get("/schema").json()["vector_fields"]) == set(VECTOR_FIELDS)


def test_schema_advertises_every_filter_with_its_semantics(client):
    """Name alone is not enough: a caller needs the type and the match kind to
    build a request that will be accepted."""
    filters = client.get("/schema").json()["filters"]
    assert set(filters) == set(FILTER_SPEC)
    for name, spec in filters.items():
        assert set(spec) == {"type", "matches", "payload_field"}
        assert spec["type"] == FILTER_SPEC[name]["type"]


def test_schema_marks_which_aggregators_cost_a_model_call(client):
    """So a caller can pick the free ones rather than discovering the bill."""
    advertised = client.get("/schema").json()["aggregators"]
    assert set(advertised) == set(aggregators.REGISTRY)
    billed = {name for name, spec in advertised.items() if spec["uses_llm"]}
    assert billed == set(aggregators.USES_LLM)


def test_schema_publishes_aggregator_dependencies(client):
    advertised = client.get("/schema").json()["aggregators"]
    assert advertised["entities"]["depends_on"] == ["people"]


def test_schema_advertises_every_detail_level(client):
    from videomind.api.core import DETAIL_LEVELS

    assert set(client.get("/schema").json()["detail_levels"]) == set(DETAIL_LEVELS)


def test_a_newly_registered_analyzer_appears_in_the_schema(client, monkeypatch):
    """AT-40 over HTTP: one registry entry, no edit to the API."""

    class TrivialAnalyzer:
        id = "trivial"

        def analyze(self, chunks, ctx):
            return []

        def render_fields(self, output):
            return {"combined": ""}

    monkeypatch.setitem(analyzers.REGISTRY, "trivial", TrivialAnalyzer())
    assert "trivial" in client.get("/schema").json()["analyzers"]


# --- the analyzer endpoint ----------------------------------------------------

def test_analyzers_endpoint_matches_the_registry(client):
    body = client.get("/analyzers").json()
    assert body["analyzers"] == analyzers.available()
    assert body["fields"] == list(VECTOR_FIELDS)


# --- liveness -----------------------------------------------------------------

def test_health_reports_what_this_instance_has_loaded(client, monkeypatch):
    """Storage is probed rather than assumed, so the probe is stubbed here --
    what is under test is the shape, not the network."""
    from videomind import storage

    monkeypatch.setattr(storage, "status", lambda: {"ok": True, "bucket": "videos", "error": None})

    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["analyzers"] == analyzers.available()
    assert body["aggregators"] == aggregators.available()


def test_health_reports_degraded_rather_than_failing_when_storage_is_unreachable(
    client, monkeypatch
):
    """A bad key would otherwise first surface as a failed ingest minutes later,
    on a background thread, in a job nobody is watching."""
    from videomind import storage

    monkeypatch.setattr(
        storage, "status",
        lambda: {"ok": False, "bucket": "videos", "error": "StorageError: no key"},
    )
    body = client.get("/health").json()
    assert body["status"] == "degraded"
    assert body["storage"]["error"]


# --- documented shapes (AT-41) ------------------------------------------------

def test_every_documented_endpoint_is_registered(client):
    """Taken from docs/ENDPOINTS.md. A route renamed without the reference
    following it fails here rather than in a client."""
    documented = {
        ("GET", "/health"),
        ("GET", "/schema"),
        ("GET", "/analyzers"),
        ("GET", "/videos"),
        ("GET", "/videos/{video_id}"),
        ("GET", "/videos/{video_id}/chunks"),
        ("GET", "/videos/{video_id}/chunks/{chunk_id}"),
        ("GET", "/videos/{video_id}/aggregates"),
        ("POST", "/videos/{video_id}/aggregates"),
        ("GET", "/videos/{video_id}/entities"),
        ("POST", "/videos"),
        ("POST", "/videos/url"),
        ("GET", "/jobs/{job_id}"),
        ("GET", "/jobs"),
        ("POST", "/query"),
        ("POST", "/ask"),
        ("GET", "/media/{video_id}"),
    }
    registered = {
        (method, route.path)
        for route in client.app.routes
        for method in getattr(route, "methods", set())
    }
    assert documented <= registered, documented - registered


def test_an_unknown_recording_is_a_404_not_an_empty_result(client):
    """An empty result and an absent recording are different situations that
    would otherwise look identical to a caller."""
    assert client.get("/videos/0000000000000000").status_code == 404


def test_an_unknown_recordings_chunks_are_a_404(client):
    assert client.get("/videos/0000000000000000/chunks").status_code == 404


def test_media_for_an_unknown_recording_is_a_404(client):
    assert client.get("/media/0000000000000000").status_code == 404


def test_an_unknown_job_is_a_404(client):
    assert client.get("/jobs/deadbeefcafe").status_code == 404


def test_a_known_recording_returns_the_documented_metadata(client, record_on_disk):
    body = client.get(f"/videos/{record_on_disk['video_id']}").json()
    for field in ("video_id", "video_url", "chunk_config", "analyzers", "chunks", "duration"):
        assert field in body, field


def test_a_known_recordings_chunks_are_paginated(client, record_on_disk):
    body = client.get(f"/videos/{record_on_disk['video_id']}/chunks?limit=2").json()
    assert body["total"] == 3 and len(body["chunks"]) == 2


def test_requesting_output_from_an_analyzer_that_never_ran_is_a_client_error(
    client, record_on_disk
):
    response = client.get(f"/videos/{record_on_disk['video_id']}/chunks?analyzer=ocr")
    assert response.status_code == 400
    assert "ocr" in response.json()["detail"]


# --- request validation -------------------------------------------------------

def test_a_search_limit_beyond_the_documented_bound_is_rejected(client):
    """Documented as 1-50. Accepting 500 would be a contract the reference does
    not describe."""
    assert client.post("/query", json={"text": "anything", "limit": 500}).status_code == 422


def test_a_search_without_a_query_is_rejected(client):
    assert client.post("/query", json={"limit": 5}).status_code == 422


def test_a_chunk_page_size_beyond_the_bound_is_rejected(client, record_on_disk):
    response = client.get(f"/videos/{record_on_disk['video_id']}/chunks?limit=5000")
    assert response.status_code == 422


def test_a_negative_offset_is_rejected(client, record_on_disk):
    response = client.get(f"/videos/{record_on_disk['video_id']}/chunks?offset=-1")
    assert response.status_code == 422


# --- the shared secret --------------------------------------------------------

def test_routes_are_guarded_when_a_token_is_configured(monkeypatch):
    """Not an authorisation model -- there are no users here -- just the
    boundary that stops the port from being one."""
    from fastapi.testclient import TestClient

    from videomind.api import app as app_module

    monkeypatch.setattr(app_module, "API_TOKEN", "s3cret")
    with TestClient(app_module.app) as guarded:
        assert guarded.get("/videos").status_code == 401
        assert guarded.get("/videos", headers={"x-core-token": "s3cret"}).status_code == 200


def test_liveness_and_docs_stay_open_so_a_deployment_can_be_checked(monkeypatch):
    from fastapi.testclient import TestClient

    from videomind import storage
    from videomind.api import app as app_module

    monkeypatch.setattr(app_module, "API_TOKEN", "s3cret")
    monkeypatch.setattr(storage, "status", lambda: {"ok": True, "bucket": "v", "error": None})

    with TestClient(app_module.app) as guarded:
        assert guarded.get("/health").status_code == 200
        assert guarded.get("/openapi.json").status_code == 200


def test_a_wrong_token_is_refused(monkeypatch):
    from fastapi.testclient import TestClient

    from videomind.api import app as app_module

    monkeypatch.setattr(app_module, "API_TOKEN", "s3cret")
    with TestClient(app_module.app) as guarded:
        assert guarded.get("/videos", headers={"x-core-token": "wrong"}).status_code == 401
