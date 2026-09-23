"""The only module that touches Laya. Loads the Router once, caps concurrent predictions and
enforces UNLOADED_MODEL_POLICY."""
import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any

from .config import Settings
from .errors import HubError
from .schemas import CALIBRATED_MAX_OPTIONS

log = logging.getLogger("laya_hub.engine")

# preset name -> (laya function, the state key its instructions refer to)
PRESETS = {
    "triage": ("triage_questions", "message"),
    "guard": ("guard_questions", "prompt"),
    "moderation": ("moderation_questions", "post"),
    "router": ("router_questions", "request"),
}


@dataclass
class Outcome:
    result: dict[str, Any]
    model: str
    warnings: list[str] = field(default_factory=list)


class Engine:
    def __init__(self, settings: Settings, router: Any = None):
        self.settings = settings
        self.router = router
        self.load_error: str | None = None
        self._slots = threading.BoundedSemaphore(settings.max_concurrency)

    # ------------------------------------------------------------ loading
    def load(self, retry_delays=(15, 30, 60, 120, 300)) -> None:
        """Build the Router and preload LAYA_MODELS. Slow (download + build), so it runs in a
        background thread. A failed attempt (e.g. a network blip during the download) is retried
        with backoff, forever, so the server heals without a restart; /health shows the last error."""
        attempt = 0
        while self.router is None:
            try:
                import torch
                from laya import Router

                torch.set_num_threads(self.settings.laya_threads)
                router = Router(max_loaded=len(self.settings.laya_models))
                router.preload(self.settings.laya_models)
                self.router = router
                self.load_error = None
                log.info("Laya ready: %s", router.loaded)
            except Exception as exc:
                delay = retry_delays[min(attempt, len(retry_delays) - 1)]
                self.load_error = f"{type(exc).__name__}: {exc}"
                log.exception("failed to load Laya (attempt %d); retrying in %ds", attempt + 1, delay)
                attempt += 1
                time.sleep(delay)

    @property
    def ready(self) -> bool:
        return self.router is not None

    def loaded_models(self) -> list[str]:
        return list(self.router.loaded) if self.router is not None else []  # a property on laya.Router

    # ------------------------------------------------------------ inference
    def decide(self, state: Any, questions: dict[str, dict], model: str | None = None) -> Outcome:
        if self.router is None:
            raise HubError(503, "model_loading", "the model is still loading; try again shortly")

        try:
            decision = dict(self.router.route(state, questions, model=model))
        except ValueError as exc:  # e.g. unknown model name
            raise HubError(400, "invalid_request", str(exc)) from exc

        loaded = self.loaded_models()
        target = decision["model"]
        warnings: list[str] = []
        if target not in loaded:
            if model is not None:
                raise HubError(422, "model_not_loaded",
                               f"model '{target}' is not loaded on this server (loaded: {', '.join(loaded)})")
            if self.settings.unloaded_model_policy == "reject":
                raise HubError(422, "model_not_loaded",
                               f"text routed to '{target}', which is not loaded on this server "
                               f"({decision.get('reason', '')}). Loaded: {', '.join(loaded)}",
                               details={"routing": decision})
            # fallback: run anyway on the first loaded model, but say so loudly.
            log.warning("language_mismatch: routed to %s, falling back to %s", target, loaded[0])
            target = loaded[0]
            warnings.append("language_mismatch")

        if not self._slots.acquire(timeout=self.settings.queue_timeout_s):
            raise HubError(503, "busy", "server is busy; try again shortly", headers={"Retry-After": "5"})
        try:
            result = self.router.predict(state, questions, model=target)
        except ValueError as exc:  # Laya's own question validation
            raise HubError(400, "invalid_request", str(exc)) from exc
        finally:
            self._slots.release()

        result = dict(result)
        result["routing"] = {**decision, "served_by": target}
        if warnings:
            result["warning"] = warnings[0]

        # Choice questions above the calibrated size (only possible if MAX_CHOICE_OPTIONS was raised).
        for name, answer in (result.get("answers") or {}).items():
            q = questions.get(name, {})
            if q.get("type") == "choice" and len(q.get("criteria") or []) > CALIBRATED_MAX_OPTIONS:
                answer["warning"] = "uncalibrated_confidence"
                if "uncalibrated_confidence" not in warnings:
                    warnings.append("uncalibrated_confidence")

        return Outcome(result=result, model=target, warnings=warnings)


def preset_questions(name: str) -> tuple[dict, str]:
    if name not in PRESETS:
        raise HubError(404, "unknown_preset", f"unknown preset '{name}'; use one of {sorted(PRESETS)}")
    import laya  # presets are pure Python; this does not import torch

    fn, state_key = PRESETS[name]
    return getattr(laya, fn)(), state_key
