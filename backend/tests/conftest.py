from __future__ import annotations

import asyncio
import io
import time
from typing import Any, Dict, Iterator, List, Optional

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import Settings
from app.errors import ProviderError
from app.main import create_app
from app.providers import TryOnOutput, TryOnProvider, TryOnRequest
from app.supabase import User


def make_image(fmt: str = "JPEG", size=(600, 800), color=(200, 120, 90), mode: str = "RGB", **save_kw: Any) -> bytes:
    img = Image.new(mode, size, color if mode == "RGB" else color + (128,))
    buf = io.BytesIO()
    img.save(buf, format=fmt, **save_kw)
    return buf.getvalue()


class FakeProvider(TryOnProvider):
    name = "fake"
    display_name = "Fake provider"

    def __init__(self, configured: bool = True) -> None:
        self._configured = configured
        self.fail: Optional[ProviderError] = None
        self.delay = 0.0
        self.calls: List[TryOnRequest] = []

    @property
    def configured(self) -> bool:
        return self._configured

    async def run(self, request: TryOnRequest, report=None) -> TryOnOutput:  # type: ignore[override]
        self.calls.append(request)
        if report:
            await report("processing", 50, "halfway")
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.fail:
            raise self.fail
        return TryOnOutput(make_image("PNG", (300, 400)), "image/png")


class FakeSupabase:
    """Minimal in-memory stand-in for SupabaseClient."""

    def __init__(self) -> None:
        self.users = {"token-a": User("11111111-1111-1111-1111-111111111111", "a@example.com")}
        self.objects: Dict[str, bytes] = {}
        self.rows: List[Dict[str, Any]] = []
        self.s: Any = None

    async def get_user(self, token: str) -> Optional[User]:
        return self.users.get(token)

    async def upload(self, path: str, data: bytes, mime: str) -> None:
        self.objects[path] = data

    async def insert_history(self, row: Dict[str, Any]) -> Dict[str, Any]:
        row = {**row, "id": f"00000000-0000-0000-0000-{len(self.rows):012d}", "created_at": "2026-01-01T00:00:00Z"}
        self.rows.append(row)
        return row

    def _uid(self, token: str) -> str:
        return self.users[token].id

    async def list_history(self, token: str, limit: int, offset: int) -> List[Dict[str, Any]]:
        uid = self._uid(token)
        return [r for r in self.rows if r["user_id"] == uid][offset : offset + limit]

    async def sign_urls(self, paths: List[str]) -> Dict[str, str]:
        return {p: f"https://signed.example/{p}?token=x" for p in paths}

    async def delete_history(self, token: str, history_id: Optional[str] = None) -> List[Dict[str, Any]]:
        uid = self._uid(token)
        hit = [r for r in self.rows if r["user_id"] == uid and (history_id is None or r["id"] == history_id)]
        self.rows = [r for r in self.rows if r not in hit]
        return hit

    async def remove_objects(self, paths: List[str]) -> None:
        for p in paths:
            self.objects.pop(p, None)

    def expires_at(self) -> Optional[str]:
        return None

    async def close(self) -> None:
        return None


def base_settings(**overrides: Any) -> Settings:
    s = Settings(tryon_provider="generic", tryon_api_url="https://provider.example/tryon")
    for k, v in overrides.items():
        setattr(s, k, v)
    return s


@pytest.fixture
def provider() -> FakeProvider:
    return FakeProvider()


@pytest.fixture
def settings() -> Settings:
    return base_settings()


@pytest.fixture
def client(settings: Settings, provider: FakeProvider) -> Iterator[TestClient]:
    app = create_app(settings, provider)
    with TestClient(app) as c:
        yield c


@pytest.fixture
def auth_client(provider: FakeProvider) -> Iterator[TestClient]:
    s = base_settings(
        supabase_url="https://proj.supabase.co", supabase_anon_key="anon", supabase_service_role_key="service"
    )
    app = create_app(s, provider)
    with TestClient(app) as c:
        fake = FakeSupabase()
        fake.s = s
        svc = app.state.services
        svc.supabase = fake
        svc.jobs.supabase = fake
        yield c


def files(person: Optional[bytes] = None, garment: Optional[bytes] = None, ptype: str = "image/jpeg") -> Dict[str, Any]:
    return {
        "person": ("person.jpg", person if person is not None else make_image(), ptype),
        "garment": ("garment.png", garment if garment is not None else make_image("PNG"), "image/png"),
    }


def wait_for(
    client: TestClient, job_id: str, headers: Optional[Dict[str, str]] = None, timeout: float = 5
) -> Dict[str, Any]:
    end = time.time() + timeout
    while time.time() < end:
        body = client.get(f"/api/tryon/jobs/{job_id}", headers=headers or {}).json()
        if body["status"] in ("succeeded", "failed"):
            return body  # type: ignore[no-any-return]
        time.sleep(0.02)
    raise AssertionError("job did not finish")
