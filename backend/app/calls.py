"""Runs one prediction request end to end: auth, rate limit, validation, inference and the call log.
Shared by /v1/systemone, /v1/presets/{name} and /admin/playground."""
import json
import logging
import time
from typing import Any, Callable

from fastapi import Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from .errors import HubError, from_validation_error
from .models import CallLog, utcnow
from .ratelimit import retry_after_header
from .schemas import DecideRequest, boolean_like_choices, check_limits
from .security import authenticate

log = logging.getLogger("laya_hub.calls")


def run_call(
    request: Request,
    payload: Any,
    parse: Callable[[Any], DecideRequest],
    *,
    endpoint: str,
    source: str = "api",
    require_key: bool = True,
) -> JSONResponse:
    st = request.app.state
    started = time.perf_counter()
    db = st.sessions()
    key_id: int | None = None
    n_questions = 0
    model: str | None = None
    warnings: list[str] = []
    status, error = 200, None

    try:
        if require_key:
            key = authenticate(db, request.headers.get("authorization"))
            key_id = key.id
            wait = st.limiter.check(key.id, key.rate_limit_per_min)
            if wait is not None:
                raise HubError(429, "rate_limited",
                               f"rate limit of {key.rate_limit_per_min} requests/min exceeded",
                               headers=retry_after_header(wait))
            key.last_used_at = utcnow()

        if not isinstance(payload, dict):
            raise HubError(400, "invalid_request", "request body must be a JSON object")
        try:
            req = parse(payload)
        except ValidationError as exc:
            raise from_validation_error(exc) from exc
        n_questions = len(req.questions)
        check_limits(req, st.settings)

        flagged = boolean_like_choices(req)
        if flagged:
            log.warning("choice labels look boolean (yes/no/true/false) in %s; Laya may follow the label "
                        "word instead of its description", flagged)
            warnings.append("boolean_like_choice_labels:" + ",".join(flagged))

        outcome = st.engine.decide(req.state, req.laya_questions(), req.model)
        model = outcome.model
        warnings = outcome.warnings + warnings
        return JSONResponse(outcome.result)

    except HubError as exc:
        status, error = exc.status, exc.message
        return JSONResponse(exc.body(), status_code=exc.status, headers=exc.headers)
    except Exception as exc:
        log.exception("prediction failed")
        status, error = 500, f"{type(exc).__name__}: {exc}"
        return JSONResponse({"error": {"code": "internal_error", "message": "prediction failed"}}, status_code=500)
    finally:
        body = None
        if st.settings.log_request_bodies and payload is not None:
            body = json.dumps(payload, ensure_ascii=False)[:2000]
        db.add(CallLog(
            key_id=key_id, source=source, endpoint=endpoint,
            latency_ms=round((time.perf_counter() - started) * 1000, 2),
            model=model, n_questions=n_questions, status_code=status,
            error=(error or None) and error[:1000],
            warning=";".join(warnings)[:200] or None, request_body=body,
        ))
        db.commit()
        db.close()
