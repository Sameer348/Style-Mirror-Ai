from __future__ import annotations

from fastapi.testclient import TestClient

from app.errors import ProviderError
from app.main import create_app

from .conftest import FakeProvider, base_settings, files, make_image, wait_for

FORM = {"category": "upper_body", "consent": "true"}


def test_health_reports_configuration(client: TestClient) -> None:
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["tryon_configured"] is True
    assert body["auth_enabled"] is False
    assert "replicate_api_token" not in str(body).lower()


def test_security_headers_and_request_id(client: TestClient) -> None:
    r = client.get("/api/health", headers={"X-Request-ID": "abc123"})
    assert r.headers["x-request-id"] == "abc123"
    assert r.headers["x-content-type-options"] == "nosniff"


def test_job_success_flow(client: TestClient, provider: FakeProvider) -> None:
    r = client.post("/api/tryon/jobs", files=files(), data=FORM)
    assert r.status_code == 202, r.text
    job = r.json()
    assert job["status"] in ("queued", "processing")
    assert r.headers["location"] == f"/api/tryon/jobs/{job['id']}"
    done = wait_for(client, job["id"])
    assert done["status"] == "succeeded"
    assert done["progress"] == 100
    result = client.get(done["result_url"])
    assert result.status_code == 200
    assert result.headers["content-type"] == "image/png"
    assert result.headers["cache-control"] == "private, no-store"
    # inputs were normalised to JPEG before reaching the provider
    assert provider.calls[0].person.mime == "image/jpeg"
    assert provider.calls[0].category == "upper_body"


def test_job_failure_is_reported_not_faked(client: TestClient, provider: FakeProvider) -> None:
    provider.fail = ProviderError("Provider exploded", retryable=True)
    job = client.post("/api/tryon/jobs", files=files(), data=FORM).json()
    done = wait_for(client, job["id"])
    assert done["status"] == "failed"
    assert done["error"] == "Provider exploded"
    assert done["retryable"] is True
    assert done["result_url"] is None
    assert client.get(f"/api/tryon/jobs/{job['id']}/result").status_code == 409


def test_consent_required(client: TestClient) -> None:
    r = client.post("/api/tryon/jobs", files=files(), data={"category": "upper_body"})
    assert r.status_code == 400
    assert r.json()["code"] == "consent_required"


def test_invalid_category(client: TestClient) -> None:
    r = client.post("/api/tryon/jobs", files=files(), data={"category": "hats", "consent": "true"})
    assert r.status_code == 400
    assert r.json()["code"] == "invalid_category"


def test_provider_not_configured_returns_503() -> None:
    app = create_app(base_settings(), FakeProvider(configured=False))
    with TestClient(app) as c:
        r = c.post("/api/tryon/jobs", files=files(), data=FORM)
        assert r.status_code == 503
        assert r.json()["code"] == "provider_not_configured"
        assert c.get("/api/health").json()["tryon_configured"] is False


def test_unknown_job_404(client: TestClient) -> None:
    r = client.get("/api/tryon/jobs/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404


def test_missing_file_is_validation_error(client: TestClient) -> None:
    r = client.post("/api/tryon/jobs", files={"person": files()["person"]}, data=FORM)
    assert r.status_code == 422
    assert r.json()["code"] == "validation_error"


def test_rate_limit_for_anonymous_users(provider: FakeProvider) -> None:
    app = create_app(base_settings(rate_limit_tryon_anonymous_per_hour=2, max_active_jobs_per_client=10), provider)
    with TestClient(app) as c:
        for _ in range(2):
            assert c.post("/api/tryon/jobs", files=files(), data=FORM).status_code == 202
        r = c.post("/api/tryon/jobs", files=files(), data=FORM)
        assert r.status_code == 429
        assert r.json()["code"] == "rate_limited"
        assert int(r.headers["retry-after"]) > 0


def test_active_job_limit(provider: FakeProvider) -> None:
    provider.delay = 1.0
    app = create_app(base_settings(max_active_jobs_per_client=1), provider)
    with TestClient(app) as c:
        assert c.post("/api/tryon/jobs", files=files(), data=FORM).status_code == 202
        r = c.post("/api/tryon/jobs", files=files(), data=FORM)
        assert r.status_code == 429
        assert r.json()["code"] == "too_many_active_jobs"


def test_payload_too_large_rejected_early(provider: FakeProvider) -> None:
    app = create_app(base_settings(max_upload_mb=1), provider)
    with TestClient(app) as c:
        big = b"\xff\xd8" + b"0" * (3 * 1024 * 1024)
        r = c.post("/api/tryon/jobs", files=files(person=big), data=FORM)
        assert r.status_code == 413


def test_legacy_sync_endpoint(client: TestClient) -> None:
    r = client.post("/api/tryon", files=files(), data=FORM)
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"


def test_legacy_sync_endpoint_provider_error(client: TestClient, provider: FakeProvider) -> None:
    provider.fail = ProviderError("nope")
    r = client.post("/api/tryon", files=files(), data=FORM)
    assert r.status_code == 502
    assert r.json() == {"detail": "nope", "code": "provider_error"}


def test_require_auth_blocks_anonymous(provider: FakeProvider) -> None:
    s = base_settings(require_auth=True, supabase_url="https://p.supabase.co", supabase_anon_key="anon")
    with TestClient(create_app(s, provider)) as c:
        r = c.post("/api/tryon/jobs", files=files(), data=FORM)
        assert r.status_code == 401
        assert r.json()["code"] == "auth_required"


def test_cors_allows_configured_origin_only(client: TestClient) -> None:
    ok = client.options(
        "/api/health", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "GET"}
    )
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:3000"
    bad = client.options(
        "/api/health", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"}
    )
    assert "access-control-allow-origin" not in bad.headers


def test_wrong_content_type_rejected(client: TestClient) -> None:
    r = client.post("/api/tryon/jobs", files=files(ptype="application/pdf"), data=FORM)
    assert r.status_code == 415


def test_non_image_bytes_rejected(client: TestClient) -> None:
    r = client.post("/api/tryon/jobs", files=files(person=b"not an image at all"), data=FORM)
    assert r.status_code == 400
    assert r.json()["code"] == "invalid_image"


def test_tiny_image_rejected(client: TestClient) -> None:
    r = client.post("/api/tryon/jobs", files=files(person=make_image(size=(100, 100))), data=FORM)
    assert r.status_code == 422
    assert r.json()["code"] == "image_too_small"
