from __future__ import annotations

from fastapi.testclient import TestClient

from .conftest import files, wait_for

AUTH = {"Authorization": "Bearer token-a"}
FORM = {"category": "dresses", "consent": "true"}


def test_invalid_token_rejected(auth_client: TestClient) -> None:
    r = auth_client.get("/api/history", headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401
    assert r.json()["code"] == "invalid_token"


def test_history_requires_login(auth_client: TestClient) -> None:
    r = auth_client.get("/api/history")
    assert r.status_code == 401
    assert r.json()["code"] == "auth_required"


def test_history_not_configured_without_supabase(client: TestClient) -> None:
    r = client.get("/api/history", headers=AUTH)
    assert r.status_code == 401
    assert r.json()["code"] == "auth_not_configured"


def test_save_list_and_delete_history(auth_client: TestClient) -> None:
    job = auth_client.post("/api/tryon/jobs", files=files(), data={**FORM, "save_to_history": "true"}, headers=AUTH)
    assert job.status_code == 202, job.text
    done = wait_for(auth_client, job.json()["id"], AUTH)
    assert done["status"] == "succeeded"
    assert done["history_id"]

    listing = auth_client.get("/api/history", headers=AUTH).json()
    assert len(listing["items"]) == 1
    item = listing["items"][0]
    assert item["image_url"].startswith("https://signed.example/11111111-1111-1111-1111-111111111111/")
    assert item["category"] == "dresses"

    deleted = auth_client.delete(f"/api/history/{item['id']}", headers=AUTH)
    assert deleted.json() == {"deleted": 1}
    assert auth_client.get("/api/history", headers=AUTH).json()["items"] == []
    fake = auth_client.app.state.services.supabase  # type: ignore[attr-defined]
    assert fake.objects == {}


def test_not_saved_without_opt_in(auth_client: TestClient) -> None:
    job = auth_client.post("/api/tryon/jobs", files=files(), data=FORM, headers=AUTH).json()
    done = wait_for(auth_client, job["id"], AUTH)
    assert done["history_id"] is None
    assert auth_client.get("/api/history", headers=AUTH).json()["items"] == []


def test_delete_all(auth_client: TestClient) -> None:
    for _ in range(2):
        job = auth_client.post(
            "/api/tryon/jobs", files=files(), data={**FORM, "save_to_history": "true"}, headers=AUTH
        ).json()
        wait_for(auth_client, job["id"], AUTH)
    assert auth_client.delete("/api/history", headers=AUTH).json() == {"deleted": 2}


def test_delete_invalid_and_missing_ids(auth_client: TestClient) -> None:
    assert auth_client.delete("/api/history/not-a-uuid", headers=AUTH).status_code == 400
    r = auth_client.delete("/api/history/00000000-0000-0000-0000-000000000099", headers=AUTH)
    assert r.status_code == 404


def test_jobs_are_scoped_to_owner(auth_client: TestClient) -> None:
    anon_job = auth_client.post("/api/tryon/jobs", files=files(), data=FORM).json()
    # A signed-in user cannot read an anonymous job from another identity
    assert auth_client.get(f"/api/tryon/jobs/{anon_job['id']}", headers=AUTH).status_code == 404
    user_job = auth_client.post("/api/tryon/jobs", files=files(), data=FORM, headers=AUTH).json()
    assert auth_client.get(f"/api/tryon/jobs/{user_job['id']}").status_code == 404
    assert auth_client.get(f"/api/tryon/jobs/{user_job['id']}", headers=AUTH).status_code == 200
