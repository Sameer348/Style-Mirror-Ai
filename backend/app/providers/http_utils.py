"""Shared helpers for provider adapters: safe result download and decoding."""

from __future__ import annotations

import base64
import binascii
from urllib.parse import urlparse

import httpx

from ..errors import ProviderError
from ..images import validate_result_image
from .base import TryOnOutput

MAX_RESULT_BYTES = 25 * 1024 * 1024


def check_url(url: str, allow_insecure: bool) -> None:
    parsed = urlparse(url)
    allowed = {"https"} | ({"http"} if allow_insecure else set())
    if parsed.scheme not in allowed or not parsed.netloc:
        raise ProviderError("Provider returned an invalid or insecure result URL.", retryable=False)


async def download_image(client: httpx.AsyncClient, url: str, allow_insecure: bool) -> TryOnOutput:
    check_url(url, allow_insecure)
    try:
        async with client.stream("GET", url, follow_redirects=True) as resp:
            if resp.status_code >= 400:
                raise ProviderError(f"Could not download the result image (HTTP {resp.status_code}).")
            chunks = []
            total = 0
            async for chunk in resp.aiter_bytes():
                total += len(chunk)
                if total > MAX_RESULT_BYTES:
                    raise ProviderError("Result image is too large.", retryable=False)
                chunks.append(chunk)
    except httpx.TimeoutException:
        raise ProviderError("Timed out downloading the result image.")
    except httpx.RequestError:
        raise ProviderError("Could not download the result image.")
    return to_output(b"".join(chunks))


def decode_base64_image(value: str) -> TryOnOutput:
    raw = value.split(",", 1)[-1] if value.startswith("data:") else value
    try:
        data = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError):
        raise ProviderError("Provider returned invalid base64 image data.", retryable=False)
    return to_output(data)


def to_output(data: bytes) -> TryOnOutput:
    try:
        mime = validate_result_image(data)
    except ValueError as exc:
        raise ProviderError(str(exc), retryable=False)
    return TryOnOutput(data=data, mime=mime)
