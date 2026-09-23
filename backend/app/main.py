import logging
import threading
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from . import routes_admin, routes_v1
from .config import Settings
from .db import make_session_factory
from .engine import Engine
from .errors import HubError, from_validation_error
from .ratelimit import RateLimiter

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("laya_hub")


def create_app(settings: Settings | None = None, router: Any = None) -> FastAPI:
    """Build the app. Tests pass a fake `router`; in production the real Laya Router is loaded
    in a background thread at startup so /health can report progress."""
    settings = settings or Settings.from_env()
    engine = Engine(settings, router=router)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if not settings.admin_secret:
            log.warning("ADMIN_SECRET is not set; admin endpoints are disabled")
        if engine.router is None:
            threading.Thread(target=engine.load, name="laya-load", daemon=True).start()
        yield

    app = FastAPI(title="laya-hub", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.sessions = make_session_factory(settings.database_url)
    app.state.engine = engine
    app.state.limiter = RateLimiter()

    @app.middleware("http")
    async def limit_body_size(request: Request, call_next):
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > settings.max_body_bytes:
            err = HubError(413, "payload_too_large", f"request body exceeds {settings.max_body_bytes} bytes")
            return JSONResponse(err.body(), status_code=413)
        return await call_next(request)

    @app.exception_handler(HubError)
    async def hub_error(_: Request, exc: HubError):
        return JSONResponse(exc.body(), status_code=exc.status, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        err = from_validation_error(exc)
        return JSONResponse(err.body(), status_code=400)

    @app.get("/health")
    def health():
        """503 until the model is loaded, so container healthchecks can use a plain `curl -f`."""
        body = {
            # While loading, `error` holds the last failed attempt (loading is retried with backoff).
            "status": "ok" if engine.ready else "loading",
            "model_loaded": engine.ready,
            "models": engine.loaded_models(),
            "error": engine.load_error,
        }
        return JSONResponse(body, status_code=200 if engine.ready else 503)

    app.include_router(routes_v1.router)
    app.include_router(routes_admin.router)
    return app
