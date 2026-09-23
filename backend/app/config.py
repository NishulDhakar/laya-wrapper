"""All runtime settings, read from environment variables in one place."""
import os
from dataclasses import dataclass, field


def _int(name: str, default: int) -> int:
    return int(os.environ.get(name, default))


def _bool(name: str, default: bool) -> bool:
    return os.environ.get(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


KNOWN_MODELS = {"english", "multilingual", "typed-decisions"}


@dataclass
class Settings:
    database_url: str = "sqlite:////data/hub.db"
    admin_secret: str = ""
    laya_models: list[str] = field(default_factory=lambda: ["english"])
    laya_threads: int = 4
    max_concurrency: int = 2
    queue_timeout_s: int = 30
    unloaded_model_policy: str = "reject"  # "reject" | "fallback"
    max_state_bytes: int = 20_000
    max_questions: int = 20
    max_choice_options: int = 10
    max_body_bytes: int = 256_000
    default_rate_limit: int = 60
    log_request_bodies: bool = False
    allow_admin_via_proxy: bool = False

    @classmethod
    def from_env(cls) -> "Settings":
        s = cls(
            database_url=os.environ.get("DATABASE_URL", cls.database_url),
            admin_secret=os.environ.get("ADMIN_SECRET", ""),
            laya_models=[m.strip() for m in os.environ.get("LAYA_MODELS", "english").split(",") if m.strip()],
            laya_threads=_int("LAYA_THREADS", cls.laya_threads),
            max_concurrency=_int("MAX_CONCURRENCY", cls.max_concurrency),
            queue_timeout_s=_int("QUEUE_TIMEOUT_S", cls.queue_timeout_s),
            unloaded_model_policy=os.environ.get("UNLOADED_MODEL_POLICY", "reject").strip().lower(),
            max_state_bytes=_int("MAX_STATE_BYTES", cls.max_state_bytes),
            max_questions=_int("MAX_QUESTIONS", cls.max_questions),
            max_choice_options=_int("MAX_CHOICE_OPTIONS", cls.max_choice_options),
            max_body_bytes=_int("MAX_BODY_BYTES", cls.max_body_bytes),
            default_rate_limit=_int("DEFAULT_RATE_LIMIT", cls.default_rate_limit),
            log_request_bodies=_bool("LOG_REQUEST_BODIES", False),
            allow_admin_via_proxy=_bool("ALLOW_ADMIN_VIA_PROXY", False),
        )
        if s.unloaded_model_policy not in ("reject", "fallback"):
            raise ValueError("UNLOADED_MODEL_POLICY must be 'reject' or 'fallback'")
        if not s.laya_models:
            raise ValueError("LAYA_MODELS must list at least one model")
        unknown = set(s.laya_models) - KNOWN_MODELS
        if unknown:
            raise ValueError(f"LAYA_MODELS has unknown model(s) {sorted(unknown)}; use {sorted(KNOWN_MODELS)}")
        return s
