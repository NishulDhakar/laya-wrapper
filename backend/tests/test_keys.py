import hashlib
import re

from app.models import ApiKey
from app.security import generate_key, hash_key

from .conftest import ADMIN, YESNO, auth


def test_generated_key_format():
    key = generate_key()
    assert re.fullmatch(r"lk_[0-9a-f]{48}", key)
    assert generate_key() != key


def test_hash_is_sha256_hex():
    assert hash_key("lk_abc") == hashlib.sha256(b"lk_abc").hexdigest()
    assert hash_key("lk_abc") == hash_key("lk_abc")
    assert hash_key("lk_abc") != hash_key("lk_abd")


def test_only_hash_is_stored(client):
    r = client.post("/admin/keys", json={"name": "svc", "rate_limit_per_min": 10}, headers=ADMIN)
    assert r.status_code == 201
    body = r.json()
    plain = body["key"]
    assert body["prefix"] == plain[:11] and body["rate_limit_per_min"] == 10

    db = client.app.state.sessions()
    row = db.get(ApiKey, body["id"])
    assert row.key_hash == hash_key(plain)
    assert plain not in (row.key_hash, row.prefix, row.name)
    db.close()

    # The listing never includes the plain key or the hash.
    listed = client.get("/admin/keys", headers=ADMIN).json()
    assert "key" not in listed[0] and "key_hash" not in listed[0]


def test_default_rate_limit_is_60(client):
    r = client.post("/admin/keys", json={"name": "svc"}, headers=ADMIN)
    assert r.json()["rate_limit_per_min"] == 60


def test_patch_and_delete(client, api_key):
    key_id = client.get("/admin/keys", headers=ADMIN).json()[0]["id"]

    r = client.patch(f"/admin/keys/{key_id}", json={"name": "renamed", "is_active": False}, headers=ADMIN)
    assert r.json()["name"] == "renamed" and r.json()["is_active"] is False
    assert client.post("/v1/systemone", json={"state": "hi", "questions": YESNO}, headers=auth(api_key)).status_code == 403

    client.patch(f"/admin/keys/{key_id}", json={"is_active": True}, headers=ADMIN)
    assert client.post("/v1/systemone", json={"state": "hi", "questions": YESNO}, headers=auth(api_key)).status_code == 200

    assert client.delete(f"/admin/keys/{key_id}", headers=ADMIN).status_code == 204
    assert client.post("/v1/systemone", json={"state": "hi", "questions": YESNO}, headers=auth(api_key)).status_code == 401
    assert client.delete(f"/admin/keys/{key_id}", headers=ADMIN).status_code == 404
