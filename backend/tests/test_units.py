from __future__ import annotations

import base64
import io
import json
from typing import List

import httpx
import pytest
from PIL import Image

from app.config import Settings, load_settings
from app.errors import ApiError, ProviderError, ProviderNotConfigured
from app.images import normalize_image
from app.providers import GenericHttpProvider, ReplicateProvider, TryOnRequest, UnconfiguredProvider
from app.providers.replicate import parse_progress
from app.ratelimit import SlidingWindowLimiter

from .conftest import make_image


def req() -> TryOnRequest:
    p = normalize_image(make_image(size=(600, 800)), "p")
    g = normalize_image(make_image("PNG"), "g")
    return TryOnRequest(person=p, garment=g, category="upper_body")


# ------------------------------------------------------------------ images
def test_normalize_strips_exif_and_resizes() -> None:
    img = Image.new("RGB", (3000, 2000), (10, 20, 30))
    exif = Image.Exif()
    exif[0x010F] = "SecretCam"  # Make
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif.tobytes())
    out = normalize_image(buf.getvalue(), "x", max_side=1024)
    assert (out.width, out.height) == (1024, 683)
    with Image.open(io.BytesIO(out.data)) as result:
        assert not result.getexif()


def test_normalize_flattens_transparency() -> None:
    out = normalize_image(make_image("PNG", mode="RGBA"), "x")
    assert out.mime == "image/jpeg"


def test_normalize_rejects_gif() -> None:
    buf = io.BytesIO()
    Image.new("RGB", (400, 400)).save(buf, "GIF")
    with pytest.raises(ApiError) as e:
        normalize_image(buf.getvalue(), "x")
    assert e.value.status_code == 415


# -------------------------------------------------------------- rate limit
def test_sliding_window() -> None:
    lim = SlidingWindowLimiter()
    assert lim.hit("k", 2, 10, now=0)[0]
    assert lim.hit("k", 2, 10, now=1)[0]
    allowed, retry = lim.hit("k", 2, 10, now=2)
    assert not allowed and retry == 8
    assert lim.hit("k", 2, 10, now=10.5)[0]


# ------------------------------------------------------------------ config
def test_config_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TRYON_PROVIDER", "magic")
    with pytest.raises(ValueError):
        load_settings(env_file=None)
    monkeypatch.setenv("TRYON_PROVIDER", "none")
    monkeypatch.setenv("REQUIRE_AUTH", "true")
    with pytest.raises(ValueError):
        load_settings(env_file=None)


def test_legacy_env_selects_generic(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TRYON_PROVIDER", raising=False)
    monkeypatch.setenv("TRYON_API_URL", "https://x.example")
    monkeypatch.setenv("FRONTEND_ORIGIN", "http://localhost:3000/")
    s = load_settings(env_file=None)
    assert s.tryon_provider == "generic"
    assert s.frontend_origins == ["http://localhost:3000"]


# -------------------------------------------------------- generic provider
def generic(handler, **kw) -> GenericHttpProvider:  # type: ignore[no-untyped-def]
    s = Settings(tryon_api_url="https://p.example/run", tryon_api_key="k", tryon_poll_interval_seconds=0, **kw)
    return GenericHttpProvider(s, transport=httpx.MockTransport(handler))


async def test_generic_image_response() -> None:
    seen: List[httpx.Request] = []

    def handler(r: httpx.Request) -> httpx.Response:
        seen.append(r)
        return httpx.Response(200, content=make_image("PNG"), headers={"content-type": "image/png"})

    out = await generic(handler).run(req())
    assert out.mime == "image/png"
    assert seen[0].headers["authorization"] == "Bearer k"
    assert b'name="category"' in seen[0].content


async def test_generic_base64_response() -> None:
    b64 = base64.b64encode(make_image()).decode()
    out = await generic(lambda r: httpx.Response(200, json={"image_base64": f"data:image/jpeg;base64,{b64}"})).run(
        req()
    )
    assert out.mime == "image/jpeg"


async def test_generic_polling_flow() -> None:
    calls = {"n": 0}
    updates: List[str] = []

    def handler(r: httpx.Request) -> httpx.Response:
        if r.method == "POST":
            return httpx.Response(202, json={"status_url": "https://p.example/jobs/1"})
        if r.url.path == "/jobs/1":
            calls["n"] += 1
            if calls["n"] < 2:
                return httpx.Response(200, json={"status": "processing", "progress": 40})
            return httpx.Response(200, json={"status": "succeeded", "image_url": "https://cdn.example/r.png"})
        return httpx.Response(200, content=make_image("PNG"), headers={"content-type": "image/png"})

    async def report(status, progress, message):  # type: ignore[no-untyped-def]
        updates.append(f"{status}:{progress}")

    out = await generic(handler).run(req(), report)
    assert out.mime == "image/png"
    assert "processing:40" in updates


async def test_generic_job_id_with_template() -> None:
    def handler(r: httpx.Request) -> httpx.Response:
        if r.method == "POST":
            return httpx.Response(200, json={"job_id": "abc"})
        assert r.url.path == "/status/abc"
        return httpx.Response(200, json={"status": "failed", "error": "bad pose"})

    with pytest.raises(ProviderError) as e:
        await generic(handler, tryon_status_url_template="https://p.example/status/{job_id}").run(req())
    assert "bad pose" in e.value.detail
    assert e.value.retryable is False


async def test_generic_rejects_insecure_result_url() -> None:
    with pytest.raises(ProviderError):
        await generic(lambda r: httpx.Response(200, json={"image_url": "http://169.254.169.254/x"})).run(req())


async def test_generic_rejects_non_image_bytes() -> None:
    with pytest.raises(ProviderError):
        await generic(lambda r: httpx.Response(200, content=b"<html>", headers={"content-type": "image/png"})).run(
            req()
        )


async def test_generic_auth_error() -> None:
    with pytest.raises(ProviderError) as e:
        await generic(lambda r: httpx.Response(401)).run(req())
    assert e.value.retryable is False


async def test_generic_network_error() -> None:
    def handler(r: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    with pytest.raises(ProviderError) as e:
        await generic(handler).run(req())
    assert "reach" in e.value.detail


async def test_unconfigured_provider() -> None:
    with pytest.raises(ProviderNotConfigured):
        await UnconfiguredProvider(Settings()).run(req())


# ------------------------------------------------------ replicate provider
def replicate(handler) -> ReplicateProvider:  # type: ignore[no-untyped-def]
    s = Settings(tryon_provider="replicate", replicate_api_token="r8_test", tryon_poll_interval_seconds=0)
    return ReplicateProvider(s, transport=httpx.MockTransport(handler))


async def test_replicate_happy_path() -> None:
    bodies: List[dict] = []
    states = iter(
        [
            {"status": "processing", "logs": " 10%|█ \n 60%|██████ "},
            {"status": "succeeded", "output": "https://replicate.delivery/out.jpg"},
        ]
    )

    def handler(r: httpx.Request) -> httpx.Response:
        if r.url.host == "api.replicate.com":
            assert r.headers["authorization"] == "Bearer r8_test"
        else:  # the result download must not leak the API token
            assert "authorization" not in r.headers
        if r.method == "POST" and r.url.path == "/v1/predictions":
            bodies.append(json.loads(r.content))
            return httpx.Response(
                201,
                json={"id": "p1", "status": "starting", "urls": {"get": "https://api.replicate.com/v1/predictions/p1"}},
            )
        if r.url.path == "/v1/predictions/p1":
            return httpx.Response(200, json={"id": "p1", **next(states), "urls": {}})
        return httpx.Response(200, content=make_image(), headers={"content-type": "image/jpeg"})

    progress: List[object] = []

    async def report(status, pct, message):  # type: ignore[no-untyped-def]
        progress.append(pct)

    out = await replicate(handler).run(req(), report)
    assert out.mime == "image/jpeg"
    inp = bodies[0]["input"]
    assert inp["category"] == "upper_body"
    assert inp["human_img"].startswith("data:image/jpeg;base64,")
    assert inp["crop"] is False  # 600x800 is already 3:4
    assert 60 in progress


async def test_replicate_failure_and_bad_token() -> None:
    def failed(r: httpx.Request) -> httpx.Response:
        return httpx.Response(201, json={"status": "failed", "error": "CUDA OOM", "urls": {"get": "https://x/1"}})

    with pytest.raises(ProviderError) as e:
        await replicate(failed).run(req())
    assert "CUDA OOM" in e.value.detail

    with pytest.raises(ProviderError) as e2:
        await replicate(lambda r: httpx.Response(401)).run(req())
    assert "token" in e2.value.detail


def test_parse_progress() -> None:
    assert parse_progress(None) is None
    assert parse_progress("loading") is None
    assert parse_progress("  3%|▏\n 47%|████") == 47
