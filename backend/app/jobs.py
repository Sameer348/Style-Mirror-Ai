"""Async try-on job manager.

Jobs live in memory on a single backend instance. Input images are held only
for the duration of the job and discarded afterwards; results are kept for
``JOB_RESULT_TTL_SECONDS`` so the browser can fetch them, then dropped.
Signed-in users can additionally save results to private Supabase Storage.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Set

from .config import Settings
from .errors import ProviderError
from .providers import TryOnOutput, TryOnProvider, TryOnRequest
from .supabase import SupabaseClient, SupabaseError

log = logging.getLogger("stylemirror.jobs")


@dataclass
class Job:
    id: str
    owner_key: str  # "user:<id>" or "ip:<addr>"
    user_id: Optional[str]
    category: str
    save_to_history: bool
    status: str = "queued"  # queued | processing | succeeded | failed
    progress: Optional[int] = None
    message: str = "Waiting to start"
    error: Optional[str] = None
    error_code: Optional[str] = None
    retryable: bool = False
    created_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None
    result: Optional[TryOnOutput] = None
    history_id: Optional[str] = None
    history_error: Optional[str] = None
    request: Optional[TryOnRequest] = None

    @property
    def active(self) -> bool:
        return self.status in ("queued", "processing")

    def public(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "status": self.status,
            "progress": self.progress,
            "message": self.message,
            "error": self.error,
            "error_code": self.error_code,
            "retryable": self.retryable,
            "category": self.category,
            "created_at": datetime.fromtimestamp(self.created_at, timezone.utc).isoformat(),
            "result_url": f"/api/tryon/jobs/{self.id}/result" if self.status == "succeeded" else None,
            "history_id": self.history_id,
            "history_error": self.history_error,
        }


class JobManager:
    def __init__(
        self,
        settings: Settings,
        provider: TryOnProvider,
        supabase: Optional[SupabaseClient] = None,
    ) -> None:
        self.settings = settings
        self.provider = provider
        self.supabase = supabase
        self.jobs: Dict[str, Job] = {}
        self._tasks: Set[asyncio.Task[None]] = set()
        self._sem = asyncio.Semaphore(max(1, settings.max_concurrent_jobs))

    def active_count(self, owner_key: str) -> int:
        return sum(1 for j in self.jobs.values() if j.owner_key == owner_key and j.active)

    def submit(
        self,
        request: TryOnRequest,
        owner_key: str,
        user_id: Optional[str],
        save_to_history: bool,
    ) -> Job:
        self.cleanup()
        job = Job(
            id=str(uuid.uuid4()),
            owner_key=owner_key,
            user_id=user_id,
            category=request.category,
            save_to_history=save_to_history and user_id is not None,
            request=request,
        )
        self.jobs[job.id] = job
        task = asyncio.create_task(self._run(job))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return job

    def get(self, job_id: str) -> Optional[Job]:
        self.cleanup()
        return self.jobs.get(job_id)

    def cleanup(self) -> None:
        cutoff = time.time() - self.settings.job_result_ttl_seconds
        for job_id in [j.id for j in self.jobs.values() if j.finished_at and j.finished_at < cutoff]:
            del self.jobs[job_id]

    async def shutdown(self) -> None:
        for task in list(self._tasks):
            task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)

    async def _run(self, job: Job) -> None:
        async def report(status: str, progress: Optional[int], message: str) -> None:
            job.status = "processing" if status == "processing" else "queued"
            job.progress = progress
            job.message = message

        assert job.request is not None
        started = time.monotonic()
        try:
            async with self._sem:
                job.status = "processing"
                job.message = "Preparing images"
                try:
                    job.result = await asyncio.wait_for(
                        self.provider.run(job.request, report),
                        timeout=self.settings.tryon_timeout_seconds + 30,
                    )
                except asyncio.TimeoutError:
                    raise ProviderError("The try-on took too long. Please retry.")
            if job.save_to_history:
                await self._save(job)
            job.status = "succeeded"
            job.progress = 100
            job.message = "Done"
            log.info("job %s succeeded provider=%s in %.1fs", job.id, self.provider.name, time.monotonic() - started)
        except ProviderError as exc:
            job.status = "failed"
            job.error = exc.detail
            job.error_code = exc.code
            job.retryable = exc.retryable
            job.message = "Failed"
            log.warning("job %s failed provider=%s code=%s: %s", job.id, self.provider.name, exc.code, exc.detail)
        except asyncio.CancelledError:
            job.status = "failed"
            job.error = "The server stopped before the try-on finished. Please retry."
            job.error_code = "cancelled"
            job.retryable = True
            raise
        except Exception:
            log.exception("job %s crashed", job.id)
            job.status = "failed"
            job.error = "Unexpected server error while generating the try-on."
            job.error_code = "internal_error"
            job.retryable = True
        finally:
            job.request = None  # drop input images as soon as possible
            job.finished_at = time.time()

    async def _save(self, job: Job) -> None:
        if not self.supabase or not job.user_id or not job.result:
            return
        ext = {"image/png": "png", "image/webp": "webp"}.get(job.result.mime, "jpg")
        path = f"{job.user_id}/{job.id}.{ext}"
        job.message = "Saving to your private history"
        uploaded = False
        try:
            await self.supabase.upload(path, job.result.data, job.result.mime)
            uploaded = True
            row = await self.supabase.insert_history(
                {
                    "user_id": job.user_id,
                    "job_id": job.id,
                    "category": job.category,
                    "provider": self.provider.name,
                    "result_path": path,
                    "garment_description": (job.request.garment_description if job.request else "") or None,
                    "expires_at": self.supabase.expires_at(),
                }
            )
            job.history_id = str(row.get("id")) if row.get("id") else None
        except (SupabaseError, Exception) as exc:  # result is still returned to the user
            log.warning("job %s history save failed: %s", job.id, exc)
            if uploaded:  # don't leave an orphaned object without a history row
                try:
                    await self.supabase.remove_objects([path])
                except Exception:
                    log.warning("job %s orphan cleanup failed", job.id)
            job.history_error = "The result was generated but could not be saved to your history."
