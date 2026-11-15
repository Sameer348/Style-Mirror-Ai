from __future__ import annotations

import re
from typing import Any, Dict

from fastapi import APIRouter, Depends, Query, Request

from ..deps import Caller, Services, require_user, services
from ..errors import ApiError
from ..supabase import SupabaseClient, SupabaseError

router = APIRouter(prefix="/api/history", tags=["history"])
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def _sb(svc: Services) -> SupabaseClient:
    if not svc.settings.history_enabled or not svc.supabase:
        raise ApiError(503, "history_not_configured", "History storage is not configured on this server.")
    return svc.supabase


@router.get("")
async def list_history(
    request: Request,
    limit: int = Query(24, ge=1, le=100),
    offset: int = Query(0, ge=0),
    caller: Caller = Depends(require_user),
) -> Dict[str, Any]:
    sb = _sb(services(request))
    assert caller.token
    try:
        rows = await sb.list_history(caller.token, limit, offset)
        signed = await sb.sign_urls([r["result_path"] for r in rows])
    except SupabaseError:
        raise ApiError(502, "storage_error", "Could not load your history. Please try again.")
    items = [
        {
            "id": r["id"],
            "job_id": r.get("job_id"),
            "category": r.get("category"),
            "provider": r.get("provider"),
            "garment_description": r.get("garment_description"),
            "created_at": r.get("created_at"),
            "expires_at": r.get("expires_at"),
            "image_url": signed.get(r["result_path"]),
        }
        for r in rows
    ]
    return {"items": items, "limit": limit, "offset": offset, "signed_url_ttl_seconds": sb.s.signed_url_ttl_seconds}


@router.delete("/{history_id}")
async def delete_item(request: Request, history_id: str, caller: Caller = Depends(require_user)) -> Dict[str, Any]:
    if not UUID_RE.match(history_id):
        raise ApiError(400, "invalid_id", "Invalid history id.")
    sb = _sb(services(request))
    assert caller.token
    try:
        rows = await sb.delete_history(caller.token, history_id)
        if not rows:
            raise ApiError(404, "not_found", "History item not found.")
        await sb.remove_objects([r["result_path"] for r in rows])
    except SupabaseError:
        raise ApiError(502, "storage_error", "Could not delete the item. Please try again.")
    return {"deleted": len(rows)}


@router.delete("")
async def delete_all(request: Request, caller: Caller = Depends(require_user)) -> Dict[str, Any]:
    """Delete every saved try-on result for the signed-in user."""
    sb = _sb(services(request))
    assert caller.token
    try:
        rows = await sb.delete_history(caller.token)
        await sb.remove_objects([r["result_path"] for r in rows])
    except SupabaseError:
        raise ApiError(502, "storage_error", "Could not delete your history. Please try again.")
    return {"deleted": len(rows)}
