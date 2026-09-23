"""Minimal client for a laya-hub server.

    pip install httpx

    from laya_hub_client import LayaHub

    hub = LayaHub("https://laya-api.example.com", api_key="lk_...")   # or env LAYA_HUB_URL / LAYA_HUB_KEY
    result = hub.decide(
        {"message": "I was charged twice, please refund me"},
        {"refund": {"type": "noul", "instructions": "Does `message` ask for money back?"}},
    )
    print(result["answers"]["refund"]["noul"])

Or the one-liner:  from laya_hub_client import decide
"""
from __future__ import annotations

import os
from typing import Any

import httpx

__all__ = ["LayaHub", "LayaHubError", "decide"]


class LayaHubError(Exception):
    def __init__(self, status: int, code: str, message: str, body: Any = None):
        super().__init__(f"{status} {code}: {message}")
        self.status, self.code, self.message, self.body = status, code, message, body


class LayaHub:
    def __init__(self, base_url: str | None = None, api_key: str | None = None, timeout: float = 60.0):
        base_url = base_url or os.environ.get("LAYA_HUB_URL")
        api_key = api_key or os.environ.get("LAYA_HUB_KEY")
        if not base_url or not api_key:
            raise ValueError("pass base_url and api_key, or set LAYA_HUB_URL and LAYA_HUB_KEY")
        self._http = httpx.Client(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=timeout,
        )

    def decide(self, state: str | dict | list, questions: dict[str, dict], model: str | None = None) -> dict:
        """Answer typed questions (choice / score / noul) about `state`. Returns answers, routing, usage."""
        body: dict[str, Any] = {"state": state, "questions": questions}
        if model:
            body["model"] = model
        return self._post("/v1/systemone", body)

    def preset(self, name: str, state: str | dict | list) -> dict:
        """Run a preset: 'triage', 'guard', 'moderation' or 'router'."""
        return self._post(f"/v1/presets/{name}", {"state": state})

    def _post(self, path: str, body: dict) -> dict:
        res = self._http.post(path, json=body)
        if res.status_code >= 400:
            try:
                data = res.json()
                err = data.get("error", {})
            except ValueError:
                data, err = res.text, {}
            raise LayaHubError(res.status_code, err.get("code", "http_error"), err.get("message", res.text), data)
        return res.json()

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "LayaHub":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


def decide(state: str | dict | list, questions: dict[str, dict], *, base_url: str | None = None,
           api_key: str | None = None, model: str | None = None) -> dict:
    """One-shot helper; reads LAYA_HUB_URL / LAYA_HUB_KEY when not given."""
    with LayaHub(base_url, api_key) as hub:
        return hub.decide(state, questions, model=model)
