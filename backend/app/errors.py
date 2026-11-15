"""Consistent JSON error responses: ``{"detail": str, "code": str}``."""

from __future__ import annotations

from typing import Dict, Optional


class ApiError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        detail: str,
        headers: Optional[Dict[str, str]] = None,
    ) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.code = code
        self.detail = detail
        self.headers = headers


class ProviderError(Exception):
    """Raised by a try-on provider adapter. ``detail`` is safe to show users."""

    def __init__(self, detail: str, code: str = "provider_error", retryable: bool = True) -> None:
        super().__init__(detail)
        self.detail = detail
        self.code = code
        self.retryable = retryable


class ProviderNotConfigured(ProviderError):
    def __init__(self, detail: str) -> None:
        super().__init__(detail, code="provider_not_configured", retryable=False)
