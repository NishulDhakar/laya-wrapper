"""Test fixtures. The Laya Router is replaced by FakeRouter, so no model is downloaded."""
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

ADMIN = {"X-Admin-Secret": "test-secret"}
KNOWN_MODELS = {"english", "multilingual", "typed-decisions"}


class FakeRouter:
    """Mimics the parts of laya.Router the hub uses: route(), loaded() and predict()."""

    def __init__(self, loaded=("english",)):
        self._loaded = list(loaded)
        self.calls = []

    def loaded(self):
        return list(self._loaded)

    def route(self, state, questions=None, model=None):
        if model is not None:
            if model not in KNOWN_MODELS:
                raise ValueError(f"unknown model {model!r}")
            return {"model": model, "reason": f"explicit model={model!r}"}
        text = state if isinstance(state, str) else str(state)
        if any(ord(ch) > 127 for ch in text):
            return {"model": "multilingual", "reason": "non-Latin script"}
        return {"model": "english", "reason": "English Latin text"}

    def predict(self, state, questions, model=None):
        self.calls.append({"state": state, "questions": questions, "model": model})
        answers = {}
        for name, q in questions.items():
            if q["type"] == "choice":
                keys = list(q["criteria"])
                answers[name] = {"type": "choice", "choice": keys[0], "confidence": 0.9,
                                 "probabilities": {k: (0.9 if i == 0 else 0.1 / (len(keys) - 1)) for i, k in enumerate(keys)}}
            elif q["type"] == "score":
                answers[name] = {"type": "score", "score": 1.0, "confidence": 0.8}
            else:
                answers[name] = {"type": "noul", "noul": 0.7, "confidence": 0.7}
        return {"answers": answers, "usage": {"input_tokens": 42, "output_tokens": 0},
                "routing": {"model": model, "reason": "explicit"}}


def make_settings(tmp_path, **overrides) -> Settings:
    values = {"database_url": f"sqlite:///{tmp_path}/hub.db", "admin_secret": "test-secret", **overrides}
    return Settings(**values)


@pytest.fixture
def fake_router():
    return FakeRouter()


@pytest.fixture
def make_client(tmp_path):
    """Build a client with custom settings/router: make_client(router=..., max_questions=5)."""
    def _make(router=None, **overrides):
        app = create_app(make_settings(tmp_path, **overrides), router=router or FakeRouter())
        return TestClient(app)
    return _make


@pytest.fixture
def client(make_client, fake_router):
    return make_client(router=fake_router)


@pytest.fixture
def api_key(client):
    r = client.post("/admin/keys", json={"name": "test"}, headers=ADMIN)
    assert r.status_code == 201
    return r.json()["key"]


def auth(key):
    return {"Authorization": f"Bearer {key}"}


YESNO = {"q": {"type": "noul", "instructions": "Is `message` a question?"}}
