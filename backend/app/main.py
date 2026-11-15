"""StyleMirror AI API application factory."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
import uuid
from typing import Any, AsyncIterator, Awaitable, Callable, Dict, Optional

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import Settings, load_settings
from .deps import Services, client_ip
from .errors import ApiError
from .jobs import JobManager
from .providers import TryOnProvider, build_provider
from .ratelimit import SlidingWindowLimiter
from .routes import history, tryon
from .supabase import SupabaseClient

log = logging.getLogger("stylemirror")


def _error(status: int, code: str, detail: str, headers: Optional[Dict[str, str]] = None) -> JSONResponse:
    return JSONResponse({"detail": detail, "code": code}, status_code=status, headers=headers)


async def _purge_loop(sb: SupabaseClient) -> None:
    while True:
        try:
            removed = await sb.purge_expired()
            if removed:
                log.info("retention purge removed %d history items", removed)
        except Exception as exc:  # keep the loop alive
            log.warning("retention purge failed: %s", exc)
        await asyncio.sleep(3600)


def create_app(settings: Optional[Settings] = None, provider: Optional[TryOnProvider] = None) -> FastAPI:
    settings = settings or load_settings()
    logging.basicConfig(level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s %(message)s")

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        sb = SupabaseClient(settings) if settings.auth_enabled else None
        jobs = JobManager(settings, provider or build_provider(settings), sb if settings.history_enabled else None)
        app.state.services = Services(settings=settings, jobs=jobs, limiter=SlidingWindowLimiter(), supabase=sb)
        purge: Optional[asyncio.Task[None]] = None
        if sb and settings.history_enabled and settings.history_retention_days > 0:
            purge = asyncio.create_task(_purge_loop(sb))
        log.info(
            "StyleMirror API ready provider=%s configured=%s auth=%s history=%s",
            jobs.provider.name,
            jobs.provider.configured,
            settings.auth_enabled,
            settings.history_enabled,
        )
        try:
            yield
        finally:
            if purge:
                purge.cancel()
            await jobs.shutdown()
            if sb:
                await sb.close()

    app = FastAPI(
        title="StyleMirror AI API",
        version="2.0.0",
        lifespan=lifespan,
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.frontend_origins,
        allow_credentials=False,  # auth uses bearer tokens, not cookies
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
        expose_headers=["Retry-After", "X-Request-ID", "Location"],
        max_age=600,
    )

    # Upload envelope: 2 images + small form fields.
    max_body = settings.max_upload_bytes * 2 + 256 * 1024

    @app.middleware("http")
    async def guard(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
        if len(request_id) > 64:
            request_id = uuid.uuid4().hex
        started = time.monotonic()
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > max_body:
            return _error(
                413, "payload_too_large", f"Upload too large. Each image must be under {settings.max_upload_mb} MB."
            )
        if request.method != "OPTIONS" and request.url.path.startswith("/api/"):
            svc: Optional[Services] = getattr(request.app.state, "services", None)
            if svc:
                ok, retry = svc.limiter.hit(
                    f"req:{client_ip(request, settings)}", settings.rate_limit_requests_per_minute, 60
                )
                if not ok:
                    return _error(429, "rate_limited", "Too many requests. Slow down.", {"Retry-After": str(retry)})
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        if settings.is_production:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        # Never log tokens or image data.
        log.info(
            "%s %s %s %.0fms rid=%s",
            request.method,
            request.url.path,
            response.status_code,
            (time.monotonic() - started) * 1000,
            request_id,
        )
        return response

    @app.exception_handler(ApiError)
    async def api_error(_: Request, exc: ApiError) -> JSONResponse:
        return _error(exc.status_code, exc.code, exc.detail, exc.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        missing = [".".join(str(p) for p in e.get("loc", [])[1:]) for e in exc.errors()]
        detail = "Invalid request" + (f": check {', '.join(m for m in missing if m)}" if missing else ".")
        return _error(422, "validation_error", detail)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return _error(exc.status_code, "http_error", str(exc.detail))

    @app.exception_handler(Exception)
    async def unhandled(_: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled error")
        return _error(500, "internal_error", "Unexpected server error.")

    @app.get("/api/health", tags=["meta"])
    async def health(request: Request) -> Dict[str, Any]:
        svc: Services = request.app.state.services
        p = svc.jobs.provider
        return {
            "status": "ok",
            "service": "StyleMirror AI",
            "version": app.version,
            "provider": p.name,
            "provider_display_name": p.display_name,
            "provider_note": p.model_note,
            "tryon_configured": p.configured,
            "auth_enabled": settings.auth_enabled,
            "history_enabled": settings.history_enabled,
            "require_auth": settings.require_auth,
            "max_upload_mb": settings.max_upload_mb,
            "history_retention_days": settings.history_retention_days,
            "job_result_ttl_seconds": settings.job_result_ttl_seconds,
        }

    app.include_router(tryon.router)
    app.include_router(history.router)
    return app
