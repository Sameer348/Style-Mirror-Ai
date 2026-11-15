"""Replicate adapter for ``cuuupid/idm-vton``.

LICENCE: IDM-VTON weights are released under CC BY-NC-SA 4.0 (non-commercial).
Do not use this adapter for a commercial product without a licence from the
rights holders. See docs/PROVIDERS.md.

Request:  POST https://api.replicate.com/v1/predictions
    {"version": "<hash>", "input": {"human_img": <data URI>, "garm_img": <data URI>,
     "garment_des": str, "category": "upper_body|lower_body|dresses",
     "crop": bool, "steps": int, "seed": int}}
Response: prediction object {id, status, output, error, logs, urls: {get, cancel}}
    status: starting | processing | succeeded | failed | canceled
    output: URI string of the result image (some versions return a list)
"""

from __future__ import annotations

import asyncio
import base64
import re
import time
from typing import Any, Dict, Optional

import httpx

from ..config import Settings
from ..errors import ProviderError, ProviderNotConfigured
from .base import ProgressCallback, TryOnOutput, TryOnProvider, TryOnRequest, _noop_report
from .http_utils import download_image

API = "https://api.replicate.com/v1/predictions"
PROGRESS_RE = re.compile(r"(\d{1,3})%\|")


def _data_uri(data: bytes, mime: str) -> str:
    return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"


def parse_progress(logs: Optional[str]) -> Optional[int]:
    if not logs:
        return None
    matches = PROGRESS_RE.findall(logs)
    if not matches:
        return None
    return max(0, min(100, int(matches[-1])))


class ReplicateProvider(TryOnProvider):
    name = "replicate"
    display_name = "Replicate (IDM-VTON model)"
    model_note = "cuuupid/idm-vton on Replicate. IDM-VTON is CC BY-NC-SA 4.0: non-commercial use only."

    def __init__(self, settings: Settings, transport: Optional[httpx.AsyncBaseTransport] = None) -> None:
        self.settings = settings
        self.transport = transport

    @property
    def configured(self) -> bool:
        return bool(self.settings.replicate_api_token and self.settings.replicate_model_version)

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.settings.replicate_api_token}",
            "Content-Type": "application/json",
        }

    async def run(self, request: TryOnRequest, report: ProgressCallback = _noop_report) -> TryOnOutput:
        if not self.configured:
            raise ProviderNotConfigured("Replicate is not configured. Set REPLICATE_API_TOKEN in backend/.env.")
        body = {
            "version": self.settings.replicate_model_version,
            "input": {
                "human_img": _data_uri(request.person.data, request.person.mime),
                "garm_img": _data_uri(request.garment.data, request.garment.mime),
                "garment_des": request.garment_description or request.category.replace("_", " ") + " garment",
                "category": request.category,
                # IDM-VTON expects 3:4 portraits; crop anything else.
                "crop": abs(request.person.width / request.person.height - 0.75) > 0.02,
                "steps": self.settings.replicate_steps,
                "seed": self.settings.replicate_seed,
            },
        }
        deadline = time.monotonic() + self.settings.tryon_timeout_seconds
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=15.0), transport=self.transport) as client:
            await report("queued", None, "Submitting to Replicate")
            try:
                resp = await client.post(API, headers=self._headers(), json=body)
            except httpx.RequestError:
                raise ProviderError("Could not reach Replicate.")
            prediction = self._parse(resp)
            get_url = (prediction.get("urls") or {}).get("get")
            cancel_url = (prediction.get("urls") or {}).get("cancel")
            if not get_url:
                raise ProviderError("Replicate did not return a prediction URL.", retryable=False)
            try:
                while True:
                    status = prediction.get("status")
                    if status == "succeeded":
                        return await self._download_output(client, prediction.get("output"))
                    if status in ("failed", "canceled"):
                        error = str(prediction.get("error") or "The model could not process these images.")
                        raise ProviderError(f"Try-on failed: {error[:300]}", retryable=False)
                    if time.monotonic() > deadline:
                        raise ProviderError("Replicate did not finish in time. Please retry.")
                    if status == "starting":
                        await report("queued", None, "Waiting for a GPU (cold starts can take a minute)")
                    else:
                        await report("processing", parse_progress(prediction.get("logs")), "Generating your try-on")
                    await asyncio.sleep(self.settings.tryon_poll_interval_seconds)
                    try:
                        prediction = self._parse(await client.get(get_url, headers=self._headers()))
                    except httpx.RequestError:
                        raise ProviderError("Lost connection to Replicate while waiting for the result.")
            except BaseException:
                # Cancelled (timeout / shutdown) or failed: do not leave a billed GPU job running.
                if cancel_url and prediction.get("status") not in ("succeeded", "failed", "canceled"):
                    try:
                        await client.post(cancel_url, headers=self._headers())
                    except Exception:  # noqa: S110 - best effort
                        pass
                raise

    def _parse(self, resp: httpx.Response) -> Dict[str, Any]:
        if resp.status_code in (401, 403):
            raise ProviderError("Replicate rejected the API token.", retryable=False)
        if resp.status_code == 402:
            raise ProviderError("Replicate account has no available credit.", retryable=False)
        if resp.status_code == 422:
            raise ProviderError("Replicate rejected the request (check REPLICATE_MODEL_VERSION).", retryable=False)
        if resp.status_code == 429:
            raise ProviderError("Replicate rate limit reached. Please retry shortly.")
        if resp.status_code >= 400:
            raise ProviderError(f"Replicate error (HTTP {resp.status_code}).", retryable=resp.status_code >= 500)
        try:
            data = resp.json()
        except ValueError:
            raise ProviderError("Replicate returned an unexpected response.", retryable=False)
        if not isinstance(data, dict):
            raise ProviderError("Replicate returned an unexpected response.", retryable=False)
        return data

    async def _download_output(self, client: httpx.AsyncClient, output: Any) -> TryOnOutput:
        if isinstance(output, list):
            output = output[-1] if output else None
        if not isinstance(output, str) or not output:
            raise ProviderError("Replicate reported success but returned no image.", retryable=False)
        return await download_image(client, output, allow_insecure=False)
