from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, Body, Depends, Header, Query, Request
from sqlalchemy import select

from .calls import run_call
from .errors import HubError
from .models import ApiKey, CallLog, utcnow
from .schemas import DecideRequest, KeyCreate, KeyCreated, KeyOut, KeyUpdate
from .security import check_admin, display_prefix, generate_key, hash_key
from .usage import usage_report


def require_admin(request: Request, x_admin_secret: str | None = Header(None)):
    settings = request.app.state.settings
    # Requests through Coolify's proxy (Traefik/Caddy) always carry X-Forwarded-For; the dashboard's
    # server-side calls on the internal network never do. So if the backend is ever given a public
    # domain, /admin stays internal-only unless explicitly allowed.
    if "x-forwarded-for" in request.headers and not settings.allow_admin_via_proxy:
        raise HubError(403, "admin_internal_only",
                       "admin endpoints are only reachable on the internal network (set ALLOW_ADMIN_VIA_PROXY=true to change this)")
    check_admin(x_admin_secret, settings.admin_secret)


router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


def get_db(request: Request):
    db = request.app.state.sessions()
    try:
        yield db
    finally:
        db.close()


def _get_key(db, key_id: int) -> ApiKey:
    key = db.get(ApiKey, key_id)
    if key is None:
        raise HubError(404, "not_found", f"no API key with id {key_id}")
    return key


# ---------------------------------------------------------------- keys

@router.post("/keys", status_code=201, response_model=KeyCreated)
def create_key(body: KeyCreate, request: Request, db=Depends(get_db)):
    plain = generate_key()
    key = ApiKey(
        name=body.name.strip(),
        key_hash=hash_key(plain),
        prefix=display_prefix(plain),
        rate_limit_per_min=body.rate_limit_per_min or request.app.state.settings.default_rate_limit,
        is_active=True,
        created_at=utcnow(),
    )
    db.add(key)
    db.commit()
    # The plain key is returned exactly once and never stored.
    return KeyCreated(**KeyOut.model_validate(key).model_dump(), key=plain)


@router.get("/keys", response_model=list[KeyOut])
def list_keys(db=Depends(get_db)):
    return list(db.scalars(select(ApiKey).order_by(ApiKey.id)))


@router.patch("/keys/{key_id}", response_model=KeyOut)
def update_key(key_id: int, body: KeyUpdate, request: Request, db=Depends(get_db)):
    key = _get_key(db, key_id)
    if body.name is not None:
        key.name = body.name.strip()
    if body.is_active is not None:
        key.is_active = body.is_active
    if body.rate_limit_per_min is not None:
        key.rate_limit_per_min = body.rate_limit_per_min
        request.app.state.limiter.forget(key.id)  # start a fresh bucket at the new size
    db.commit()
    return key


@router.delete("/keys/{key_id}", status_code=204)
def delete_key(key_id: int, request: Request, db=Depends(get_db)):
    db.delete(_get_key(db, key_id))
    db.commit()
    request.app.state.limiter.forget(key_id)


# ---------------------------------------------------------------- usage & logs

@router.get("/usage")
def usage(
    days: int = Query(7, ge=1, le=365),
    start: date | None = Query(None, description="YYYY-MM-DD; overrides days"),
    end: date | None = Query(None, description="YYYY-MM-DD; defaults to today"),
    db=Depends(get_db),
):
    now = utcnow()
    end = end or now.date()
    start = start or end - timedelta(days=days - 1)
    if start > end:
        raise HubError(400, "invalid_request", "start must be on or before end")
    if (end - start).days > 365:
        raise HubError(400, "invalid_request", "date range is limited to 366 days")
    return usage_report(db, start, end, now)


@router.get("/logs")
def logs(limit: int = Query(100, ge=1, le=1000), key_id: int | None = None, db=Depends(get_db)):
    q = select(CallLog).order_by(CallLog.id.desc()).limit(limit)
    if key_id is not None:
        q = q.where(CallLog.key_id == key_id)
    names = {k.id: k.name for k in db.scalars(select(ApiKey))}
    return [
        {
            "id": r.id,
            "created_at": r.created_at.isoformat() + "Z",
            "key_id": r.key_id,
            "key_name": names.get(r.key_id) if r.key_id is not None else None,
            "source": r.source,
            "endpoint": r.endpoint,
            "status_code": r.status_code,
            "latency_ms": r.latency_ms,
            "model": r.model,
            "n_questions": r.n_questions,
            "error": r.error,
            "warning": r.warning,
            "request_body": r.request_body,
        }
        for r in db.scalars(q)
    ]


# ---------------------------------------------------------------- playground

@router.post("/playground")
def playground(request: Request, payload: Any = Body(None)):
    return run_call(request, payload, DecideRequest.model_validate,
                    endpoint="/admin/playground", source="playground", require_key=False)
