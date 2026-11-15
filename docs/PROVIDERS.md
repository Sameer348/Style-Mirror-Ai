# Try-on providers

The backend talks to an AI model through an adapter (`backend/app/providers/`).
Choose one with `TRYON_PROVIDER` in `backend/.env`. Credentials stay on the server only.

| `TRYON_PROVIDER` | Adapter | Use when |
|---|---|---|
| `none` (default) | `UnconfiguredProvider` | No model yet. The API returns `503 provider_not_configured`, and the UI disables Generate with an explanation. |
| `replicate` | `ReplicateProvider` | Hosted IDM-VTON on Replicate. Async (queued) predictions, polled with progress. |
| `generic` | `GenericHttpProvider` | Any endpoint that implements the "StyleMirror provider protocol v1" below: a commercial API, your own GPU server, or CatVTON behind a wrapper. |

No adapter ever returns a placeholder. A job is marked `succeeded` only after the provider returns bytes that Pillow verifies as a real JPEG, PNG or WEBP.

Before forwarding, every input is decoded, auto-rotated, flattened to RGB, resized (longest side `MAX_IMAGE_SIDE`, default 1536) and re-encoded as JPEG. This strips EXIF/GPS metadata.

---

## Licences: read before launching

| Model | Licence | Commercial use |
|---|---|---|
| **IDM-VTON** (yisol/IDM-VTON; `cuuupid/idm-vton` on Replicate) | CC BY-NC-SA 4.0 | **No.** Non-commercial / research only. |
| **CatVTON** (Zheng-Chong/CatVTON) | CC BY-NC-SA 4.0 | **No.** Non-commercial / research only. |

If StyleMirror is a commercial product (ads, subscriptions, a retailer integration), you must either get a commercial licence from the rights holders or use a provider whose model is licensed for commercial use. Connect that provider through the `generic` adapter, or add a new adapter. Licences change, so verify the current terms on each model's repository before launch.

Also read your provider's terms on data retention. They process users' face and body photos. Name the provider in your privacy policy (the UI consent text shows `provider_display_name` from `/api/health`).

---

## Replicate (`cuuupid/idm-vton`)

```env
TRYON_PROVIDER=replicate
REPLICATE_API_TOKEN=r8_...
REPLICATE_MODEL_VERSION=0513734a452173b8173e907e3a59d19a36266e55b48528559432bd21c7d7e985
REPLICATE_STEPS=30
REPLICATE_SEED=42
```

Pin the version hash you tested. Inputs differ slightly between versions; see https://replicate.com/cuuupid/idm-vton/versions.

**Request** (`POST https://api.replicate.com/v1/predictions`, `Authorization: Bearer $REPLICATE_API_TOKEN`):

```json
{
  "version": "0513734a…",
  "input": {
    "human_img": "data:image/jpeg;base64,…",
    "garm_img": "data:image/jpeg;base64,…",
    "garment_des": "white linen shirt",
    "category": "upper_body",
    "crop": false,
    "steps": 30,
    "seed": 42
  }
}
```

- `category`: `upper_body` | `lower_body` | `dresses`
- `crop` is set to `true` automatically when the person photo is not 3:4.
- `garment_des` falls back to e.g. `"upper body garment"` if the user leaves it empty.

**Response** (prediction object):

```json
{ "id": "…", "status": "starting|processing|succeeded|failed|canceled",
  "output": "https://replicate.delivery/…/out.jpg", "error": null, "logs": " 47%|████ …",
  "urls": { "get": "https://api.replicate.com/v1/predictions/…", "cancel": "…/cancel" } }
```

The adapter polls `urls.get` every `TRYON_POLL_INTERVAL_SECONDS`. It parses progress from tqdm-style `NN%|` lines in `logs`, downloads `output` without sending the API token, and cancels the prediction if it times out (`TRYON_TIMEOUT_SECONDS`), so you aren't billed for abandoned GPU time.

Error mapping: 401/403 → bad token · 402 → no credit · 422 → bad version/input · 429 → retryable rate limit.

---

## Generic HTTP: "StyleMirror provider protocol v1"

```env
TRYON_PROVIDER=generic
TRYON_API_URL=https://your-provider.example/tryon
TRYON_API_KEY=secret                 # sent as Authorization: Bearer <key>
TRYON_STATUS_URL_TEMPLATE=           # optional, e.g. https://your-provider.example/jobs/{job_id}
```

**Request:** `POST TRYON_API_URL`, `multipart/form-data`

| field | type | notes |
|---|---|---|
| `person` | file `image/jpeg` | normalised person photo |
| `garment` | file `image/jpeg` | normalised garment photo |
| `category` | text | `upper_body` \| `lower_body` \| `dresses` |
| `garment_description` | text | may be empty, ≤ 200 chars |

**Responses accepted:**

1. Synchronous image: `200`, `Content-Type: image/png|jpeg|webp`, raw bytes.
2. JSON with an inline image: `{"image_base64": "<base64 or data URI>"}`
3. JSON with an image URL (https only): `{"image_url": "https://…"}`. The backend downloads it (max 25 MB).
4. A queued job: `{"status_url": "https://…"}`, or `{"job_id": "abc"}` with `TRYON_STATUS_URL_TEMPLATE`.
   The backend `GET`s the status URL until it sees:
   ```json
   {"status": "queued|processing|succeeded|failed", "progress": 0-100, "message": "…",
    "image_url": "https://…" | "image_base64": "…", "error": "…"}
   ```
   `succeeded`, `completed` and `done` count as success; `failed`, `error` and `canceled` count as failure.

HTTP 401/403 is treated as a configuration error (not retryable). 5xx and network errors are retryable.

Result URLs must be `https://` unless `ALLOW_INSECURE_PROVIDER_URLS=true`, which is for local self-hosting only. This prevents a malicious or broken provider from making the backend fetch internal `http://` addresses.

---

## Adding a new adapter

1. Subclass `TryOnProvider` in `backend/app/providers/<name>.py` and implement `configured` and `async run(request, report)`.
2. Call `await report(status, progress_or_None, message)` while waiting. The UI shows it.
3. Raise `ProviderError(detail, retryable=…)` on any failure. Never return a fake image.
4. Register it in `build_provider()` and accept the name in `Settings.validate()`.
5. Add tests with `httpx.MockTransport` (see `backend/tests/test_units.py`).

---

## Optional: self-hosting IDM-VTON / CatVTON on a GPU

Do this only for **non-commercial or research** deployments, because of the CC BY-NC-SA licences above.

- **Hardware:** an NVIDIA GPU with about 16 GB VRAM for IDM-VTON at 768×1024 (24 GB recommended). CatVTON is lighter (about 8–10 GB). You need a CUDA 12-compatible driver.
- **Steps:**
  1. Clone the model repository and follow its install instructions (conda env, weights download from Hugging Face).
  2. Wrap its inference function in a small HTTP service that implements protocol v1 above, either the synchronous image response or the `status_url` queue form.
  3. Run it on a private network. Point `TRYON_API_URL` at it and set `TRYON_API_KEY` to a shared secret that your wrapper checks.
  4. Keep `MAX_CONCURRENT_JOBS` at or below what one GPU can hold, usually 1–2.
- No wrapper ships with this repo, because each model's inference API differs between releases. Test your wrapper with the curl examples in `docs/API.md`.
