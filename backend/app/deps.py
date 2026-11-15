"""FastAPI dependencies: settings, services, auth and client identity."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from fastapi import Request

from .config import Settings
from .errors import ApiError
from .jobs import JobManager
from .ratelimit import SlidingWindowLimiter
from .supabase import SupabaseClient, SupabaseError, User


@dataclass
class Services:
    settings: Settings
    jobs: JobManager
    limiter: SlidingWindowLimiter
    supabase: Optional[SupabaseClient]


def services(request: Request) -> Services:
    return request.app.state.services  # type: ignore[no-any-return]


def client_ip(request: Request, settings: Settings) -> str:
    if settings.trust_proxy_headers:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def bearer_token(request: Request) -> Optional[str]:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        token = header[7:].strip()
        return token or None
    return None


@dataclass
class Caller:
    user: Optional[User]
    token: Optional[str]
    ip: str

    @property
    def key(self) -> str:
        return f"user:{self.user.id}" if self.user else f"ip:{self.ip}"


async def get_caller(request: Request) -> Caller:
    svc = services(request)
    ip = client_ip(request, svc.settings)
    token = bearer_token(request)
    user: Optional[User] = None
    if token:
        if not svc.supabase:
            raise ApiError(401, "auth_not_configured", "Sign-in is not configured on this server.")
        try:
            user = await svc.supabase.get_user(token)
        except SupabaseError:
            raise ApiError(503, "auth_unavailable", "Could not verify your session. Please try again.")
        if user is None:
            raise ApiError(401, "invalid_token", "Your session has expired. Please sign in again.")
    return Caller(user=user, token=token if user else None, ip=ip)


async def require_user(request: Request) -> Caller:
    caller = await get_caller(request)
    if not caller.user:
        raise ApiError(401, "auth_required", "Please sign in to continue.")
    return caller
