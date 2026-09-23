from typing import Any

from fastapi import APIRouter, Body, Request

from .calls import run_call
from .engine import preset_questions
from .schemas import DecideRequest, PresetRequest

router = APIRouter(prefix="/v1", tags=["v1"])


@router.post("/systemone")
def systemone(request: Request, payload: Any = Body(None)):
    """Jev-compatible System 1 call: {state, questions[, model]} -> answers, routing, usage."""
    return run_call(request, payload, DecideRequest.model_validate, endpoint="/v1/systemone")


@router.post("/presets/{name}")
def preset(name: str, request: Request, payload: Any = Body(None)):
    """Run one of Laya's preset question sets. A plain-string state is wrapped under the key the
    preset's instructions refer to (triage: message, guard: prompt, moderation: post, router: request)."""

    def parse(body: Any) -> DecideRequest:
        questions, state_key = preset_questions(name)
        req = PresetRequest.model_validate(body)
        state = {state_key: req.state} if isinstance(req.state, str) else req.state
        return DecideRequest.model_validate({"state": state, "questions": questions, "model": req.model})

    return run_call(request, payload, parse, endpoint=f"/v1/presets/{name}")
