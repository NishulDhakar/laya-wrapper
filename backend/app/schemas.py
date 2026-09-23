"""Request/response models. Structural rules live here; size limits that depend on settings are
checked in `check_limits` so they stay configurable."""
import json
import re
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .config import Settings
from .errors import HubError

QUESTION_NAME = r"^[A-Za-z0-9_]{1,64}$"
BOOLEAN_WORDS = {"true", "false", "yes", "no"}
NOUL_KEYS = {"false", "true"}
# The English checkpoint's confidence is only calibrated for choice questions with up to 10 options.
CALIBRATED_MAX_OPTIONS = 10


class Question(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["choice", "score", "noul"]
    instructions: str = Field(min_length=1, max_length=2000)
    criteria: dict[str, str | None] | list[str] | None = None
    labels: dict[str, str] | None = None

    @model_validator(mode="after")
    def check_shape(self):
        c = self.criteria
        if self.type == "choice":
            if not c:
                raise ValueError("a choice question needs 'criteria': a dict of label -> description, or a list of labels")
            keys = list(c) if isinstance(c, dict) else c
            if len(keys) < 2:
                raise ValueError("a choice question needs at least 2 options")
            if any(not str(k).strip() for k in keys):
                raise ValueError("choice labels must be non-empty")
            if len(set(keys)) != len(keys):
                raise ValueError("choice labels must be unique")
        elif self.type == "score":
            if not isinstance(c, list) or len(c) < 2:
                raise ValueError("a score question needs 'criteria' as a list of at least 2 level descriptions, lowest first")
            if any(not s.strip() for s in c):
                raise ValueError("score levels must be non-empty")
        else:  # noul
            if c is not None:
                if not isinstance(c, dict) or set(c) != NOUL_KEYS:
                    raise ValueError("a noul question's 'criteria' must have exactly the keys 'false' and 'true'")
                if any(not isinstance(v, str) or not v.strip() for v in c.values()):
                    raise ValueError("noul criteria descriptions must be non-empty strings")

        if self.labels is not None:
            if self.type != "noul":
                raise ValueError("'labels' is only supported for noul questions")
            if set(self.labels) != NOUL_KEYS:
                raise ValueError("noul 'labels' must have exactly the keys 'false' and 'true'")
            f, t = self.labels["false"].strip(), self.labels["true"].strip()
            if not f or not t or f == t:
                raise ValueError("noul 'labels' values must be distinct and non-empty")
        return self

    def option_count(self) -> int:
        return len(self.criteria) if self.type == "choice" and self.criteria else 0


class DecideRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    state: str | dict[str, Any] | list[Any]
    questions: dict[str, Question]
    model: str | None = None

    @field_validator("questions")
    @classmethod
    def check_names(cls, qs: dict[str, Question]):
        if not qs:
            raise ValueError("at least one question is required")
        bad = [n for n in qs if not re.match(QUESTION_NAME, n)]
        if bad:
            raise ValueError(f"question names must match {QUESTION_NAME}: {bad}")
        return qs

    def laya_questions(self) -> dict[str, dict]:
        # Drop unset top-level fields only; choice criteria may legitimately map a label to None.
        return {n: {k: v for k, v in q.model_dump().items() if v is not None} for n, q in self.questions.items()}


class PresetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    state: str | dict[str, Any] | list[Any]
    model: str | None = None


def state_size(state: Any) -> int:
    if isinstance(state, str):
        return len(state.encode())
    return len(json.dumps(state, ensure_ascii=False).encode())


def check_limits(req: DecideRequest, settings: Settings) -> None:
    size = state_size(req.state)
    if size > settings.max_state_bytes:
        raise HubError(400, "state_too_large", f"state is {size} bytes; the limit is {settings.max_state_bytes}")
    if isinstance(req.state, str) and not req.state.strip():
        raise HubError(400, "invalid_request", "state must not be empty")
    if len(req.questions) > settings.max_questions:
        raise HubError(400, "too_many_questions",
                       f"{len(req.questions)} questions; the limit is {settings.max_questions} per request")
    for name, q in req.questions.items():
        if q.option_count() > settings.max_choice_options:
            raise HubError(400, "too_many_options",
                           f"question '{name}' has {q.option_count()} options; the limit is "
                           f"{settings.max_choice_options} (confidence is uncalibrated above {CALIBRATED_MAX_OPTIONS})")


def boolean_like_choices(req: DecideRequest) -> list[str]:
    """Choice questions whose labels are words like yes/no/true/false. Laya can follow the label
    word instead of its description, so these are worth a warning (not an error)."""
    out = []
    for name, q in req.questions.items():
        if q.type == "choice" and q.criteria:
            if any(str(k).strip().lower() in BOOLEAN_WORDS for k in q.criteria):
                out.append(name)
    return out


# ---------------------------------------------------------------- admin payloads

class KeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    rate_limit_per_min: int | None = Field(default=None, ge=1, le=100_000)


class KeyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    is_active: bool | None = None
    rate_limit_per_min: int | None = Field(default=None, ge=1, le=100_000)


class KeyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    prefix: str
    rate_limit_per_min: int
    is_active: bool
    created_at: datetime
    last_used_at: datetime | None


class KeyCreated(KeyOut):
    key: str
