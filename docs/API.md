# StyleMirror AI API

Base URL: `http://localhost:8000` (dev). Interactive OpenAPI docs: `/docs` (disabled when `ENVIRONMENT=production`).

All errors use one shape:

```json
{ "detail": "Human readable message", "code": "machine_code" }
```

Authentication is optional unless `REQUIRE_AUTH=true`. Send a Supabase access token as `Authorization: Bearer <token>`. Signed-in users get higher rate limits and history.

## `GET /api/health`

```bash
curl http://localhost:8000/api/health
```

```json
{ "status": "ok", "provider": "replicate", "provider_display_name": "Replicate (IDM-VTON model)",
  "provider_note": "…", "tryon_configured": true, "auth_enabled": true, "history_enabled": true,
  "require_auth": false, "max_upload_mb": 12, "history_retention_days": 30, "job_result_ttl_seconds": 1800 }
```

## `POST /api/tryon/jobs`: start an async try-on (202)

multipart fields: `person` (file), `garment` (file), `category` (`upper_body`|`lower_body`|`dresses`), `consent` (must be `true`), `garment_description` (optional, ≤200), `save_to_history` (`true` to save; requires sign-in).

```bash
curl -X POST http://localhost:8000/api/tryon/jobs \
  -F person=@me.jpg -F garment=@shirt.png \
  --form-string category=upper_body --form-string consent=true
```

```json
{ "id": "6b0c…", "status": "queued", "progress": null, "message": "Waiting to start", "error": null,
  "error_code": null, "retryable": false, "category": "upper_body", "created_at": "2026-11-15T10:00:00+00:00",
  "result_url": null, "history_id": null, "history_error": null, "poll_url": "/api/tryon/jobs/6b0c…" }
```

## `GET /api/tryon/jobs/{id}`: poll status

```bash
curl http://localhost:8000/api/tryon/jobs/6b0c…
```

`status`: `queued` → `processing` → `succeeded` | `failed`. `progress` is 0–100 or `null` (unknown). When it fails, `error` and `retryable` tell the UI whether to offer Retry.

Jobs are bound to whoever created them: the signed-in user, or the client IP for anonymous jobs. Anyone else gets a 404.

## `GET /api/tryon/jobs/{id}/result`: result image

```bash
curl -o result.jpg http://localhost:8000/api/tryon/jobs/6b0c…/result
```

Returns the image bytes (`Cache-Control: private, no-store`). Results stay in server memory for `JOB_RESULT_TTL_SECONDS` (default 30 min). Returns `409 result_not_ready` until the job succeeds.

## `POST /api/tryon`: legacy synchronous endpoint

Same fields as `/api/tryon/jobs` minus `save_to_history`. It blocks until the provider finishes and returns the image. Kept for compatibility with the original starter; prefer the jobs API.

## History (sign-in required, Supabase configured)

```bash
TOKEN=…   # supabase.auth.getSession() → access_token
curl -H "Authorization: Bearer $TOKEN" "http://localhost:8000/api/history?limit=24&offset=0"
curl -X DELETE -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/history/<history_id>
curl -X DELETE -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/history   # delete everything
```

`GET` returns `{ "items": [{ "id", "job_id", "category", "provider", "garment_description", "created_at", "expires_at", "image_url" }], "signed_url_ttl_seconds": 3600 }`. `image_url` is a short-lived signed Storage URL.

## Error codes

| HTTP | code | meaning |
|---|---|---|
| 400 | `consent_required` | `consent=true` missing |
| 400 | `invalid_category`, `invalid_image`, `empty_file`, `description_too_long`, `invalid_id` | bad input |
| 401 | `auth_required`, `invalid_token`, `auth_not_configured` | sign-in problems |
| 404 | `job_not_found`, `not_found` | unknown, expired or not yours |
| 409 | `result_not_ready` | poll until `succeeded` |
| 413 | `file_too_large`, `payload_too_large`, `image_too_large` | over `MAX_UPLOAD_MB` or 40 MP |
| 415 | `unsupported_media_type` | not JPG/PNG/WEBP |
| 422 | `image_too_small`, `validation_error` | under `MIN_IMAGE_SIDE` / missing field |
| 429 | `rate_limited`, `too_many_active_jobs` | see `Retry-After` header |
| 502 | `provider_error`, `storage_error` | upstream failed |
| 503 | `provider_not_configured`, `history_not_configured`, `auth_unavailable` | server setup |

Failed jobs report `error_code` values such as `provider_error`, `provider_not_configured`, `cancelled` or `internal_error`.
