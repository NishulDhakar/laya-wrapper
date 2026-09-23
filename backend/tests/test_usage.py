from datetime import datetime, timedelta

from app.models import CallLog
from app.usage import p95, usage_report

from .conftest import ADMIN, YESNO, auth


def test_p95_nearest_rank():
    assert p95([]) == 0.0
    assert p95([5.0]) == 5.0
    assert p95(list(range(1, 101))) == 95
    assert p95(list(range(1, 21))) == 19


def _log(db, when, key_id=1, status=200, latency=10.0, source="api"):
    db.add(CallLog(key_id=key_id, source=source, endpoint="/v1/systemone", created_at=when,
                   latency_ms=latency, n_questions=1, status_code=status))


def test_usage_report_aggregates(client):
    db = client.app.state.sessions()
    now = datetime(2026, 9, 23, 12, 0)
    today, yesterday = now, now - timedelta(days=1)
    for lat in (10, 20, 30):
        _log(db, today, key_id=1, latency=lat)
    _log(db, today, key_id=1, status=500, latency=40)
    _log(db, yesterday, key_id=2, latency=100)
    _log(db, today, key_id=None, source="playground", latency=5)
    _log(db, now - timedelta(days=10), key_id=1)  # outside the range
    db.commit()

    rep = usage_report(db, (now - timedelta(days=6)).date(), now.date(), now)
    db.close()

    assert rep["totals"]["calls"] == 6
    assert rep["totals"]["errors"] == 1
    assert rep["today"]["calls"] == 5
    assert len(rep["per_day"]) == 7
    assert rep["per_day"][-1] == {"date": "2026-09-23", **rep["today"]}
    assert rep["per_day"][-2]["calls"] == 1 and rep["per_day"][0]["calls"] == 0

    k1 = next(k for k in rep["per_key"] if k["key_id"] == 1)
    assert k1["calls"] == 4 and k1["errors"] == 1 and k1["error_rate"] == 0.25
    assert k1["avg_latency_ms"] == 25.0 and k1["p95_latency_ms"] == 40
    assert k1["name"] == "#1 (deleted)"
    assert any(k["name"] == "playground" for k in rep["per_key"])


def test_usage_endpoint_counts_real_calls(client, api_key):
    for _ in range(3):
        client.post("/v1/systemone", json={"state": "hi", "questions": YESNO}, headers=auth(api_key))
    client.post("/v1/systemone", json={"state": "hi", "questions": {}}, headers=auth(api_key))  # 400

    rep = client.get("/admin/usage?days=7", headers=ADMIN).json()
    assert rep["totals"]["calls"] == 4 and rep["totals"]["errors"] == 1
    assert rep["per_key"][0]["name"] == "test"

    logs = client.get("/admin/logs?limit=2", headers=ADMIN).json()
    assert len(logs) == 2
    assert logs[0]["status_code"] == 400 and logs[0]["error"]
    assert logs[1]["model"] == "english" and logs[1]["n_questions"] == 1
    assert logs[1]["request_body"] is None  # bodies are not stored by default


def test_request_bodies_logged_only_when_enabled(make_client):
    c = make_client(log_request_bodies=True)
    key = c.post("/admin/keys", json={"name": "k"}, headers=ADMIN).json()["key"]
    c.post("/v1/systemone", json={"state": "secret text", "questions": YESNO}, headers=auth(key))
    assert "secret text" in c.get("/admin/logs", headers=ADMIN).json()[0]["request_body"]


def test_usage_date_range(client):
    r = client.get("/admin/usage?start=2026-09-01&end=2026-09-03", headers=ADMIN)
    assert [d["date"] for d in r.json()["per_day"]] == ["2026-09-01", "2026-09-02", "2026-09-03"]
    assert client.get("/admin/usage?start=2026-09-05&end=2026-09-01", headers=ADMIN).status_code == 400
