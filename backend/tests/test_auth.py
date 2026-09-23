from .conftest import ADMIN, YESNO, auth

BODY = {"state": "Is this a question?", "questions": YESNO}


def test_missing_header(client):
    r = client.post("/v1/systemone", json=BODY)
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthorized"


def test_wrong_scheme(client, api_key):
    r = client.post("/v1/systemone", json=BODY, headers={"Authorization": f"Token {api_key}"})
    assert r.status_code == 401


def test_invalid_key(client, api_key):
    r = client.post("/v1/systemone", json=BODY, headers=auth("lk_" + "0" * 48))
    assert r.status_code == 401


def test_valid_key(client, api_key):
    r = client.post("/v1/systemone", json=BODY, headers=auth(api_key))
    assert r.status_code == 200
    data = r.json()
    assert data["answers"]["q"]["type"] == "noul"
    assert data["routing"]["served_by"] == "english"
    assert data["usage"]["input_tokens"] == 42


def test_auth_checked_before_validation(client):
    r = client.post("/v1/systemone", json={"nonsense": True})
    assert r.status_code == 401


def test_admin_requires_secret(client):
    assert client.get("/admin/keys").status_code == 401
    assert client.get("/admin/keys", headers={"X-Admin-Secret": "wrong"}).status_code == 401
    assert client.get("/admin/keys", headers=ADMIN).status_code == 200


def test_admin_disabled_without_secret(make_client):
    c = make_client(admin_secret="")
    assert c.get("/admin/keys", headers=ADMIN).status_code == 503


def test_api_key_is_not_an_admin_secret(client, api_key):
    assert client.get("/admin/keys", headers={"X-Admin-Secret": api_key}).status_code == 401


def test_playground_needs_admin_not_key(client):
    assert client.post("/admin/playground", json=BODY).status_code == 401
    r = client.post("/admin/playground", json=BODY, headers=ADMIN)
    assert r.status_code == 200


def test_health_is_public(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["model_loaded"] is True
