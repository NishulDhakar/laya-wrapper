from app.ratelimit import RateLimiter

from .conftest import ADMIN, YESNO, auth


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def test_bucket_allows_burst_then_blocks():
    clock = Clock()
    rl = RateLimiter(clock)
    assert all(rl.check(1, 3) is None for _ in range(3))
    wait = rl.check(1, 3)
    assert wait is not None and 0 < wait <= 20  # 3/min -> one token every 20 s


def test_bucket_refills():
    clock = Clock()
    rl = RateLimiter(clock)
    for _ in range(3):
        rl.check(1, 3)
    assert rl.check(1, 3) is not None
    clock.t += 20
    assert rl.check(1, 3) is None


def test_buckets_are_per_key():
    rl = RateLimiter(Clock())
    rl.check(1, 1)
    assert rl.check(1, 1) is not None
    assert rl.check(2, 1) is None


def test_api_returns_429_with_retry_after(client):
    key = client.post("/admin/keys", json={"name": "slow", "rate_limit_per_min": 2}, headers=ADMIN).json()["key"]
    body = {"state": "hello", "questions": YESNO}
    assert client.post("/v1/systemone", json=body, headers=auth(key)).status_code == 200
    assert client.post("/v1/systemone", json=body, headers=auth(key)).status_code == 200
    r = client.post("/v1/systemone", json=body, headers=auth(key))
    assert r.status_code == 429
    assert r.json()["error"]["code"] == "rate_limited"
    assert int(r.headers["Retry-After"]) >= 1

    logs = client.get("/admin/logs", headers=ADMIN).json()
    assert logs[0]["status_code"] == 429


def test_raising_limit_resets_bucket(client):
    created = client.post("/admin/keys", json={"name": "k", "rate_limit_per_min": 1}, headers=ADMIN).json()
    body = {"state": "hello", "questions": YESNO}
    assert client.post("/v1/systemone", json=body, headers=auth(created["key"])).status_code == 200
    assert client.post("/v1/systemone", json=body, headers=auth(created["key"])).status_code == 429
    client.patch(f"/admin/keys/{created['id']}", json={"rate_limit_per_min": 100}, headers=ADMIN)
    assert client.post("/v1/systemone", json=body, headers=auth(created["key"])).status_code == 200
