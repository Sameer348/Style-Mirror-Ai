from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse, Response

from ..deps import Caller, Services, get_caller, services
from ..errors import ApiError, ProviderError
from ..images import normalize_image, read_upload
from ..providers import CATEGORIES, TryOnRequest

router = APIRouter(prefix="/api", tags=["try-on"])


def _truthy(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


async def _build_request(
    svc: Services,
    caller: Caller,
    person: UploadFile,
    garment: UploadFile,
    category: str,
    consent: str,
    garment_description: str,
) -> TryOnRequest:
    s = svc.settings
    if s.require_auth and not caller.user:
        raise ApiError(401, "auth_required", "Please sign in to use AI try-on.")
    if not _truthy(consent):
        raise ApiError(
            400,
            "consent_required",
            "Consent is required before your photo is sent to the third-party AI provider.",
        )
    if category not in CATEGORIES:
        raise ApiError(400, "invalid_category", "Category must be upper_body, lower_body or dresses.")
    if len(garment_description) > 200:
        raise ApiError(400, "description_too_long", "Garment description must be 200 characters or fewer.")
    if not svc.jobs.provider.configured:
        raise ApiError(
            503,
            "provider_not_configured",
            "AI try-on provider is not configured on the server. See README > Connect a try-on provider.",
        )

    window = 3600
    limit = s.rate_limit_tryon_user_per_hour if caller.user else s.rate_limit_tryon_anonymous_per_hour
    allowed, retry = svc.limiter.hit(f"tryon:{caller.key}", limit, window)
    if not allowed:
        hint = "" if caller.user or not s.auth_enabled else " Sign in for a higher limit."
        raise ApiError(
            429,
            "rate_limited",
            f"Try-on limit reached. Please try again in {max(1, retry // 60)} min.{hint}",
            headers={"Retry-After": str(retry)},
        )

    person_raw = await read_upload(person, s.max_upload_bytes, "Your photo")
    garment_raw = await read_upload(garment, s.max_upload_bytes, "Clothing photo")
    return TryOnRequest(
        person=normalize_image(person_raw, "Your photo", s.max_image_side, s.min_image_side),
        garment=normalize_image(garment_raw, "Clothing photo", s.max_image_side, s.min_image_side),
        category=category,
        garment_description=garment_description.strip(),
    )


@router.post("/tryon/jobs", status_code=202)
async def create_job(
    request: Request,
    person: UploadFile = File(...),
    garment: UploadFile = File(...),
    category: str = Form("upper_body"),
    consent: str = Form("false"),
    garment_description: str = Form(""),
    save_to_history: str = Form("false"),
    caller: Caller = Depends(get_caller),
) -> JSONResponse:
    svc = services(request)
    if svc.jobs.active_count(caller.key) >= svc.settings.max_active_jobs_per_client:
        raise ApiError(429, "too_many_active_jobs", "Please wait for your current try-on to finish.")
    tryon_request = await _build_request(svc, caller, person, garment, category, consent, garment_description)
    save = _truthy(save_to_history)
    if save and not svc.settings.history_enabled:
        save = False
    job = svc.jobs.submit(tryon_request, caller.key, caller.user.id if caller.user else None, save)
    body: Dict[str, Any] = job.public()
    body["poll_url"] = f"/api/tryon/jobs/{job.id}"
    return JSONResponse(body, status_code=202, headers={"Location": body["poll_url"]})


def _owned_job(request: Request, job_id: str, caller: Caller):  # type: ignore[no-untyped-def]
    job = services(request).jobs.get(job_id)
    # Job IDs are random UUID4s; additionally bind jobs to the signed-in user
    # or (for anonymous jobs) the submitting IP.
    if not job or job.owner_key != caller.key:
        raise ApiError(404, "job_not_found", "Try-on job not found or expired.")
    return job


@router.get("/tryon/jobs/{job_id}")
async def get_job(request: Request, job_id: str, caller: Caller = Depends(get_caller)) -> Dict[str, Any]:
    return _owned_job(request, job_id, caller).public()  # type: ignore[no-any-return]


@router.get("/tryon/jobs/{job_id}/result")
async def get_job_result(request: Request, job_id: str, caller: Caller = Depends(get_caller)) -> Response:
    job = _owned_job(request, job_id, caller)
    if job.status != "succeeded" or not job.result:
        raise ApiError(409, "result_not_ready", "The result is not ready.")
    return Response(
        job.result.data,
        media_type=job.result.mime,
        headers={"Cache-Control": "private, no-store", "Content-Disposition": 'inline; filename="stylemirror-result"'},
    )


@router.post("/tryon")
async def tryon_sync(
    request: Request,
    person: UploadFile = File(...),
    garment: UploadFile = File(...),
    category: str = Form("upper_body"),
    consent: str = Form("false"),
    garment_description: str = Form(""),
    caller: Caller = Depends(get_caller),
) -> Response:
    """Legacy synchronous endpoint (kept for compatibility). Prefer /api/tryon/jobs."""
    svc = services(request)
    tryon_request = await _build_request(svc, caller, person, garment, category, consent, garment_description)
    try:
        output = await svc.jobs.provider.run(tryon_request)
    except ProviderError as exc:
        status = 503 if exc.code == "provider_not_configured" else 502
        raise ApiError(status, exc.code, exc.detail)
    return Response(output.data, media_type=output.mime, headers={"Cache-Control": "private, no-store"})
