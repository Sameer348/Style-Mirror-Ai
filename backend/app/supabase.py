"""Thin Supabase REST client (Auth, PostgREST, Storage) built on httpx.

Key handling:
* User-scoped reads/deletes on ``tryon_history`` are sent with the user's own
  access token + anon key, so Postgres Row Level Security enforces ownership.
* The service-role key is only used server side for writes the user must not
  be able to forge (inserting history rows, uploading generated results) and
  for storage deletes/signing after ownership was checked through RLS.
"""

from __future__ import annotations

import hashlib
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

import httpx

from .config import Settings

log = logging.getLogger("stylemirror.supabase")


@dataclass
class User:
    id: str
    email: Optional[str] = None


class SupabaseError(Exception):
    pass


class SupabaseClient:
    def __init__(self, settings: Settings, transport: Optional[httpx.AsyncBaseTransport] = None) -> None:
        self.s = settings
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=10.0), transport=transport)
        self._user_cache: Dict[str, Tuple[float, User]] = {}

    async def close(self) -> None:
        await self._client.aclose()

    # ---------------------------------------------------------------- auth
    async def get_user(self, access_token: str) -> Optional[User]:
        """Validate an access token with Supabase Auth. Cached for 60s."""
        key = hashlib.sha256(access_token.encode()).hexdigest()
        cached = self._user_cache.get(key)
        now = time.monotonic()
        if cached and cached[0] > now:
            return cached[1]
        try:
            resp = await self._client.get(
                f"{self.s.supabase_url}/auth/v1/user",
                headers={"apikey": self.s.supabase_anon_key, "Authorization": f"Bearer {access_token}"},
            )
        except httpx.RequestError as exc:
            raise SupabaseError("Could not reach Supabase Auth") from exc
        if resp.status_code in (401, 403):
            return None
        if resp.status_code >= 400:
            raise SupabaseError(f"Supabase Auth error {resp.status_code}")
        data = resp.json()
        user = User(id=str(data["id"]), email=data.get("email"))
        if len(self._user_cache) > 10_000:
            self._user_cache.clear()
        self._user_cache[key] = (now + 60, user)
        return user

    # ------------------------------------------------------------- headers
    def _service_headers(self) -> Dict[str, str]:
        key = self.s.supabase_service_role_key
        return {"apikey": key, "Authorization": f"Bearer {key}"}

    def _user_headers(self, token: str) -> Dict[str, str]:
        return {"apikey": self.s.supabase_anon_key, "Authorization": f"Bearer {token}"}

    def _check(self, resp: httpx.Response, what: str) -> None:
        if resp.status_code >= 400:
            log.warning("supabase %s failed: %s", what, resp.status_code)
            raise SupabaseError(f"{what} failed ({resp.status_code})")

    # -------------------------------------------------------------- storage
    def _object_path(self, path: str) -> str:
        return f"{quote(self.s.supabase_bucket)}/{quote(path)}"

    async def upload(self, path: str, data: bytes, mime: str) -> None:
        resp = await self._client.post(
            f"{self.s.supabase_url}/storage/v1/object/{self._object_path(path)}",
            headers={**self._service_headers(), "Content-Type": mime, "x-upsert": "false"},
            content=data,
        )
        self._check(resp, "storage upload")

    async def sign_urls(self, paths: List[str]) -> Dict[str, str]:
        if not paths:
            return {}
        resp = await self._client.post(
            f"{self.s.supabase_url}/storage/v1/object/sign/{quote(self.s.supabase_bucket)}",
            headers=self._service_headers(),
            json={"expiresIn": self.s.signed_url_ttl_seconds, "paths": paths},
        )
        self._check(resp, "storage sign")
        out: Dict[str, str] = {}
        for item in resp.json():
            signed = item.get("signedURL")
            if signed and item.get("path"):
                out[item["path"]] = f"{self.s.supabase_url}/storage/v1{signed}"
        return out

    async def remove_objects(self, paths: List[str]) -> None:
        if not paths:
            return
        resp = await self._client.request(
            "DELETE",
            f"{self.s.supabase_url}/storage/v1/object/{quote(self.s.supabase_bucket)}",
            headers=self._service_headers(),
            json={"prefixes": paths},
        )
        self._check(resp, "storage delete")

    # -------------------------------------------------------------- history
    async def insert_history(self, row: Dict[str, Any]) -> Dict[str, Any]:
        resp = await self._client.post(
            f"{self.s.supabase_url}/rest/v1/tryon_history",
            headers={**self._service_headers(), "Prefer": "return=representation"},
            json=row,
        )
        self._check(resp, "history insert")
        rows = resp.json()
        return rows[0] if isinstance(rows, list) and rows else row

    async def list_history(self, token: str, limit: int, offset: int) -> List[Dict[str, Any]]:
        resp = await self._client.get(
            f"{self.s.supabase_url}/rest/v1/tryon_history",
            headers=self._user_headers(token),
            params={
                "select": "id,job_id,category,provider,result_path,garment_description,created_at,expires_at",
                "order": "created_at.desc",
                "limit": str(limit),
                "offset": str(offset),
            },
        )
        self._check(resp, "history list")
        return list(resp.json())

    async def delete_history(self, token: str, history_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Delete one row (or all of the user's rows). RLS restricts to the owner."""
        params = {"select": "id,result_path"}
        if history_id:
            params["id"] = f"eq.{history_id}"
        else:
            params["id"] = "not.is.null"  # PostgREST requires a filter for DELETE
        resp = await self._client.request(
            "DELETE",
            f"{self.s.supabase_url}/rest/v1/tryon_history",
            headers={**self._user_headers(token), "Prefer": "return=representation"},
            params=params,
        )
        self._check(resp, "history delete")
        return list(resp.json())

    async def purge_expired(self) -> int:
        now = datetime.now(timezone.utc).isoformat()
        resp = await self._client.request(
            "DELETE",
            f"{self.s.supabase_url}/rest/v1/tryon_history",
            headers={**self._service_headers(), "Prefer": "return=representation"},
            params={"select": "id,result_path", "expires_at": f"lt.{now}"},
        )
        self._check(resp, "history purge")
        rows = resp.json()
        await self.remove_objects([r["result_path"] for r in rows if r.get("result_path")])
        return len(rows)

    def expires_at(self) -> Optional[str]:
        if self.s.history_retention_days <= 0:
            return None
        return (datetime.now(timezone.utc) + timedelta(days=self.s.history_retention_days)).isoformat()
