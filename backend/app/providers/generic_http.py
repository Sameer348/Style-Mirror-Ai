"""Generic HTTP adapter ("StyleMirror provider protocol v1").

Request: ``POST TRYON_API_URL`` (multipart/form-data)
    person    file (image/jpeg)
    garment   file (image/jpeg)
    category  upper_body | lower_body | dresses
    garment_description  optional text
    Authorization: Bearer TRYON_API_KEY   (if set)

Accepted responses:
    1. ``image/*`` body                         -> done
    2. JSON ``{"image_base64": "..."}``          -> done
    3. JSON ``{"image_url": "https://..."}``     -> done (downloaded server side)
    4. JSON ``{"status_url": "https://..."}`` or ``{"job_id": "..."}`` with
       TRYON_STATUS_URL_TEMPLATE (e.g. ``https://host/jobs/{job_id}``)
       -> poll with GET until JSON ``status`` is one of
          succeeded|completed (+ image_url/image_base64) or failed|error|canceled.
          Optional ``progress`` (0-100) and ``message`` fields are surfaced.

See docs/PROVIDERS.md for the full schema.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Dict, Optional

import httpx

from ..config import Settings
from ..errors import ProviderError, ProviderNotConfigured
from .base import ProgressCallback, TryOnOutput, TryOnProvider, TryOnRequest, _noop_report
from .http_utils import check_url, decode_base64_image, download_image, to_output

SUCCESS = {"succeeded", "success", "completed", "complete", "done"}
FAILURE = {"failed", "failure", "error", "canceled", "cancelled"}


class GenericHttpProvider(TryOnProvider):
    name = "generic"
    display_name = "your configured try-on API"
    model_note = "Custom endpoint; model and licence depend on your provider."

    def __init__(self, settings: Settings, transport: Optional[httpx.AsyncBaseTransport] = None) -> None:
        self.settings = settings
        self.transport = transport

    @property
    def configured(self) -> bool:
        return bool(self.settings.tryon_api_url)

    def _headers(self) -> Dict[str, str]:
        headers = {"Accept": "image/*, application/json"}
        if self.settings.tryon_api_key:
            headers["Authorization"] = f"Bearer {self.settings.tryon_api_key}"
        return headers

    async def run(self, request: TryOnRequest, report: ProgressCallback = _noop_report) -> TryOnOutput:
        if not self.configured:
            raise ProviderNotConfigured(
                "AI try-on provider is not configured. Set TRYON_API_URL (and TRYON_API_KEY) in backend/.env."
            )
        deadline = time.monotonic() + self.settings.tryon_timeout_seconds
        timeout = httpx.Timeout(self.settings.tryon_timeout_seconds, connect=15.0)
        async with httpx.AsyncClient(timeout=timeout, transport=self.transport) as client:
            files = {
                "person": ("person.jpg", request.person.data, request.person.mime),
                "garment": ("garment.jpg", request.garment.data, request.garment.mime),
            }
            data = {"category": request.category, "garment_description": request.garment_description}
            await report("processing", None, "Sending images to the try-on provider")
            try:
                resp = await client.post(self.settings.tryon_api_url, headers=self._headers(), files=files, data=data)
            except httpx.TimeoutException:
                raise ProviderError("The try-on provider timed out.")
            except httpx.RequestError:
                raise ProviderError("Could not reach the AI try-on provider.")
            if resp.status_code in (401, 403):
                raise ProviderError("The try-on provider rejected the API key.", retryable=False)
            if resp.status_code >= 400:
                raise ProviderError(
                    f"Try-on provider error (HTTP {resp.status_code}).", retryable=resp.status_code >= 500
                )

            ctype = resp.headers.get("content-type", "")
            if ctype.startswith("image/"):
                return to_output(resp.content)
            payload = self._json(resp)
            done = await self._result_from_payload(client, payload)
            if done:
                return done

            status_url = payload.get("status_url")
            if not status_url and payload.get("job_id") and self.settings.tryon_status_url_template:
                status_url = self.settings.tryon_status_url_template.format(job_id=payload["job_id"])
            if not status_url:
                raise ProviderError(
                    "Provider JSON must contain image_url, image_base64, status_url or job_id.", retryable=False
                )
            check_url(status_url, self.settings.allow_insecure_provider_urls)
            return await self._poll(client, status_url, deadline, report)

    def _json(self, resp: httpx.Response) -> Dict[str, Any]:
        try:
            payload = resp.json()
        except ValueError:
            raise ProviderError("Provider returned an unsupported response.", retryable=False)
        if not isinstance(payload, dict):
            raise ProviderError("Provider returned an unsupported response.", retryable=False)
        return payload

    async def _result_from_payload(self, client: httpx.AsyncClient, payload: Dict[str, Any]) -> Optional[TryOnOutput]:
        if payload.get("image_base64"):
            return decode_base64_image(str(payload["image_base64"]))
        if payload.get("image_url"):
            return await download_image(client, str(payload["image_url"]), self.settings.allow_insecure_provider_urls)
        return None

    async def _poll(
        self, client: httpx.AsyncClient, status_url: str, deadline: float, report: ProgressCallback
    ) -> TryOnOutput:
        await report("queued", None, "Queued at the provider")
        while True:
            if time.monotonic() > deadline:
                raise ProviderError("The try-on provider did not finish in time.")
            await asyncio.sleep(self.settings.tryon_poll_interval_seconds)
            try:
                resp = await client.get(status_url, headers=self._headers())
            except httpx.RequestError:
                raise ProviderError("Lost connection to the try-on provider while waiting for the result.")
            if resp.status_code >= 400:
                raise ProviderError(f"Provider status check failed (HTTP {resp.status_code}).")
            payload = self._json(resp)
            status = str(payload.get("status", "")).lower()
            if status in FAILURE:
                fallback = "The provider could not process these images."
                message = str(payload.get("error") or payload.get("message") or fallback)
                raise ProviderError(f"Try-on failed: {message[:300]}", retryable=False)
            if status in SUCCESS:
                done = await self._result_from_payload(client, payload)
                if not done:
                    raise ProviderError("Provider reported success but returned no image.", retryable=False)
                return done
            progress = payload.get("progress")
            pct = int(progress) if isinstance(progress, (int, float)) else None
            await report(
                "processing" if status not in {"queued", "pending", "starting"} else "queued",
                pct,
                str(payload.get("message") or "Generating your try-on"),
            )
