"""Upload validation and normalisation.

Every image is decoded with Pillow, checked against an allow-list of real
formats (not just the client-supplied Content-Type), auto-rotated, flattened
to RGB, resized, and re-encoded as JPEG. Re-encoding drops EXIF metadata such
as GPS location before anything is sent to a third-party provider.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

from fastapi import UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from .errors import ApiError

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}
MAX_PIXELS = 40_000_000  # decompression-bomb guard
CHUNK = 1024 * 1024


@dataclass
class ImagePayload:
    data: bytes
    mime: str
    width: int
    height: int


async def read_upload(upload: UploadFile, max_bytes: int, label: str) -> bytes:
    if upload.content_type not in ALLOWED_CONTENT_TYPES:
        raise ApiError(415, "unsupported_media_type", f"{label}: please upload a JPG, PNG or WEBP image.")
    chunks = []
    total = 0
    while True:
        chunk = await upload.read(CHUNK)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise ApiError(
                413,
                "file_too_large",
                f"{label}: image must be smaller than {max_bytes // (1024 * 1024)} MB.",
            )
        chunks.append(chunk)
    if total == 0:
        raise ApiError(400, "empty_file", f"{label}: the uploaded file is empty.")
    return b"".join(chunks)


def normalize_image(
    raw: bytes,
    label: str,
    max_side: int = 1536,
    min_side: int = 256,
) -> ImagePayload:
    try:
        with Image.open(io.BytesIO(raw)) as probe:
            fmt = probe.format
            width, height = probe.size
            probe.verify()
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError):
        raise ApiError(400, "invalid_image", f"{label}: the uploaded file is not a valid image.")
    except Image.DecompressionBombError:
        raise ApiError(413, "image_too_large", f"{label}: image dimensions are too large.")

    if fmt not in ALLOWED_FORMATS:
        raise ApiError(415, "unsupported_media_type", f"{label}: please upload a JPG, PNG or WEBP image.")
    if width * height > MAX_PIXELS:
        raise ApiError(413, "image_too_large", f"{label}: image dimensions are too large.")
    if min(width, height) < min_side:
        raise ApiError(
            422,
            "image_too_small",
            f"{label}: image is too small ({width}x{height}). Use at least {min_side}px on the short side.",
        )

    try:
        with Image.open(io.BytesIO(raw)) as img:
            img = ImageOps.exif_transpose(img)
            if img.mode in ("RGBA", "LA", "P"):
                rgba = img.convert("RGBA")
                background = Image.new("RGB", rgba.size, (255, 255, 255))
                background.paste(rgba, mask=rgba.split()[-1])
                img = background
            else:
                img = img.convert("RGB")
            img.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
            out = io.BytesIO()
            img.save(out, format="JPEG", quality=92, optimize=True)
            return ImagePayload(out.getvalue(), "image/jpeg", img.width, img.height)
    except ApiError:
        raise
    except Exception:
        raise ApiError(400, "invalid_image", f"{label}: the image could not be processed.")


def validate_result_image(data: bytes) -> str:
    """Check bytes returned by a provider really are an image. Returns MIME type."""
    try:
        with Image.open(io.BytesIO(data)) as img:
            fmt = img.format
            img.verify()
    except Exception:
        raise ValueError("Provider returned data that is not a valid image.")
    mime = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}.get(fmt or "")
    if not mime:
        raise ValueError(f"Provider returned an unsupported image format: {fmt}.")
    return mime
