"""Runtime configuration loaded from environment variables.

All secrets live here (server side only). Nothing in this module is ever
returned to the browser except the explicitly public fields exposed by
``/api/health``.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import List, Optional

from dotenv import load_dotenv

# Default Replicate model version for cuuupid/idm-vton. Pin the version you
# have tested; see docs/PROVIDERS.md.
DEFAULT_REPLICATE_VERSION = "0513734a452173b8173e907e3a59d19a36266e55b48528559432bd21c7d7e985"


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ValueError(f"Environment variable {name} must be an integer, got {raw!r}") from exc


def _float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw)
    except ValueError as exc:
        raise ValueError(f"Environment variable {name} must be a number, got {raw!r}") from exc


def _str(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


def _list(name: str, default: str) -> List[str]:
    return [item.strip().rstrip("/") for item in _str(name, default).split(",") if item.strip()]


@dataclass
class Settings:
    # General
    environment: str = "development"
    log_level: str = "INFO"
    frontend_origins: List[str] = field(default_factory=lambda: ["http://localhost:3000"])
    trust_proxy_headers: bool = False

    # Uploads
    max_upload_mb: int = 12
    max_image_side: int = 1536
    min_image_side: int = 256

    # Provider
    tryon_provider: str = "none"  # none | generic | replicate
    tryon_api_url: str = ""
    tryon_api_key: str = ""
    tryon_status_url_template: str = ""
    tryon_timeout_seconds: float = 240.0
    tryon_poll_interval_seconds: float = 2.0
    allow_insecure_provider_urls: bool = False
    replicate_api_token: str = ""
    replicate_model_version: str = DEFAULT_REPLICATE_VERSION
    replicate_steps: int = 30
    replicate_seed: int = 42

    # Jobs
    max_concurrent_jobs: int = 4
    max_active_jobs_per_client: int = 2
    job_result_ttl_seconds: int = 1800

    # Rate limits
    rate_limit_tryon_anonymous_per_hour: int = 5
    rate_limit_tryon_user_per_hour: int = 30
    rate_limit_requests_per_minute: int = 120

    # Supabase
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    supabase_bucket: str = "tryon-results"
    require_auth: bool = False
    signed_url_ttl_seconds: int = 3600
    history_retention_days: int = 30

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def auth_enabled(self) -> bool:
        return bool(self.supabase_url and self.supabase_anon_key)

    @property
    def history_enabled(self) -> bool:
        return self.auth_enabled and bool(self.supabase_service_role_key)

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"

    def validate(self) -> None:
        if self.tryon_provider not in {"none", "generic", "replicate"}:
            raise ValueError("TRYON_PROVIDER must be one of: none, generic, replicate")
        if self.require_auth and not self.auth_enabled:
            raise ValueError("REQUIRE_AUTH=true needs SUPABASE_URL and SUPABASE_ANON_KEY")
        if self.supabase_url and not self.supabase_url.startswith("https://") and self.is_production:
            raise ValueError("SUPABASE_URL must use https in production")
        if self.max_upload_mb < 1 or self.max_upload_mb > 50:
            raise ValueError("MAX_UPLOAD_MB must be between 1 and 50")


def load_settings(env_file: Optional[str] = ".env") -> Settings:
    if env_file:
        load_dotenv(env_file)
    provider = _str("TRYON_PROVIDER").lower()
    # Backwards compatibility: the original starter only had TRYON_API_URL.
    if not provider:
        provider = "generic" if _str("TRYON_API_URL") else "none"
    settings = Settings(
        environment=_str("ENVIRONMENT", "development"),
        log_level=_str("LOG_LEVEL", "INFO").upper(),
        frontend_origins=_list("FRONTEND_ORIGINS", _str("FRONTEND_ORIGIN", "http://localhost:3000")),
        trust_proxy_headers=_bool("TRUST_PROXY_HEADERS", False),
        max_upload_mb=_int("MAX_UPLOAD_MB", 12),
        max_image_side=_int("MAX_IMAGE_SIDE", 1536),
        min_image_side=_int("MIN_IMAGE_SIDE", 256),
        tryon_provider=provider,
        tryon_api_url=_str("TRYON_API_URL"),
        tryon_api_key=_str("TRYON_API_KEY"),
        tryon_status_url_template=_str("TRYON_STATUS_URL_TEMPLATE"),
        tryon_timeout_seconds=_float("TRYON_TIMEOUT_SECONDS", 240.0),
        tryon_poll_interval_seconds=_float("TRYON_POLL_INTERVAL_SECONDS", 2.0),
        allow_insecure_provider_urls=_bool("ALLOW_INSECURE_PROVIDER_URLS", False),
        replicate_api_token=_str("REPLICATE_API_TOKEN"),
        replicate_model_version=_str("REPLICATE_MODEL_VERSION", DEFAULT_REPLICATE_VERSION),
        replicate_steps=_int("REPLICATE_STEPS", 30),
        replicate_seed=_int("REPLICATE_SEED", 42),
        max_concurrent_jobs=_int("MAX_CONCURRENT_JOBS", 4),
        max_active_jobs_per_client=_int("MAX_ACTIVE_JOBS_PER_CLIENT", 2),
        job_result_ttl_seconds=_int("JOB_RESULT_TTL_SECONDS", 1800),
        rate_limit_tryon_anonymous_per_hour=_int("RATE_LIMIT_TRYON_ANONYMOUS_PER_HOUR", 5),
        rate_limit_tryon_user_per_hour=_int("RATE_LIMIT_TRYON_USER_PER_HOUR", 30),
        rate_limit_requests_per_minute=_int("RATE_LIMIT_REQUESTS_PER_MINUTE", 120),
        supabase_url=_str("SUPABASE_URL").rstrip("/"),
        supabase_anon_key=_str("SUPABASE_ANON_KEY"),
        supabase_service_role_key=_str("SUPABASE_SERVICE_ROLE_KEY"),
        supabase_bucket=_str("SUPABASE_BUCKET", "tryon-results"),
        require_auth=_bool("REQUIRE_AUTH", False),
        signed_url_ttl_seconds=_int("SIGNED_URL_TTL_SECONDS", 3600),
        history_retention_days=_int("HISTORY_RETENTION_DAYS", 30),
    )
    settings.validate()
    return settings
