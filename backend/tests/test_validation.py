import pytest

from .conftest import FakeRouter, auth


def post(client, key, body):
    return client.post("/v1/systemone", json=body, headers=auth(key))


def err(r):
    assert r.status_code == 400, r.text
    return r.json()["error"]["message"]


CHOICE = {"type": "choice", "instructions": "Pick", "criteria": {"a": "first", "b": "second"}}
SCORE = {"type": "score", "instructions": "Rate", "criteria": ["low", "high"]}
NOUL = {"type": "noul", "instructions": "Yes or no?"}


def test_all_types_accepted(client, api_key):
    body = {"state": {"message": "hello"}, "questions": {
        "c": CHOICE, "c_list": {**CHOICE, "criteria": ["x", "y"]}, "s": SCORE, "n": NOUL,
        "n2": {**NOUL, "criteria": {"false": "not a question", "true": "a question"},
               "labels": {"false": "B", "true": "A"}},
    }}
    r = post(client, api_key, body)
    assert r.status_code == 200, r.text
    assert set(r.json()["answers"]) == {"c", "c_list", "s", "n", "n2"}


@pytest.mark.parametrize("question, fragment", [
    ({"type": "maybe", "instructions": "x"}, "type"),
    ({"type": "noul"}, "instructions"),
    ({"type": "noul", "instructions": ""}, "instructions"),
    ({**CHOICE, "criteria": None}, "choice question needs 'criteria'"),
    ({**CHOICE, "criteria": {"only": "one"}}, "at least 2 options"),
    ({**CHOICE, "criteria": ["a", "a"]}, "unique"),
    ({**SCORE, "criteria": {"a": "b"}}, "score question"),
    ({**SCORE, "criteria": ["one"]}, "at least 2"),
    ({**NOUL, "criteria": {"yes": "a", "no": "b"}}, "exactly the keys 'false' and 'true'"),
    ({**NOUL, "criteria": {"true": "a"}}, "exactly the keys 'false' and 'true'"),
    ({**NOUL, "criteria": {"true": "a", "false": ""}}, "non-empty"),
    ({**NOUL, "labels": {"true": "A"}}, "labels"),
    ({**NOUL, "labels": {"true": "A", "false": "A"}}, "distinct"),
    ({**NOUL, "labels": {"true": "A", "false": "  "}}, "non-empty"),
    ({**CHOICE, "labels": {"true": "A", "false": "B"}}, "only supported for noul"),
    ({**NOUL, "extra": 1}, "extra"),
])
def test_bad_questions(client, api_key, question, fragment):
    msg = err(post(client, api_key, {"state": "hi", "questions": {"q": question}}))
    assert fragment.lower() in msg.lower()


def test_bad_question_name(client, api_key):
    assert "question names" in err(post(client, api_key, {"state": "hi", "questions": {"bad name!": NOUL}}))


def test_empty_questions_and_state(client, api_key):
    assert "at least one question" in err(post(client, api_key, {"state": "hi", "questions": {}}))
    assert "state" in err(post(client, api_key, {"state": "   ", "questions": {"q": NOUL}}))
    assert "state" in err(post(client, api_key, {"questions": {"q": NOUL}}))


def test_body_must_be_object(client, api_key):
    r = client.post("/v1/systemone", content=b"[1,2]", headers={**auth(api_key), "content-type": "application/json"})
    assert r.status_code == 400
    r = client.post("/v1/systemone", content=b"{not json", headers={**auth(api_key), "content-type": "application/json"})
    assert r.status_code == 400


def test_state_size_cap(client, api_key):
    r = post(client, api_key, {"state": "x" * 20_001, "questions": {"q": NOUL}})
    assert r.status_code == 400 and r.json()["error"]["code"] == "state_too_large"
    assert post(client, api_key, {"state": "x" * 20_000, "questions": {"q": NOUL}}).status_code == 200


def test_question_count_cap(client, api_key):
    qs = {f"q{i}": NOUL for i in range(21)}
    r = post(client, api_key, {"state": "hi", "questions": qs})
    assert r.status_code == 400 and r.json()["error"]["code"] == "too_many_questions"


def test_body_size_cap(client, api_key):
    r = post(client, api_key, {"state": "x" * 300_000, "questions": {"q": NOUL}})
    assert r.status_code == 413


def test_choice_option_cap(client, api_key):
    q = {**CHOICE, "criteria": [f"o{i}" for i in range(11)]}
    r = post(client, api_key, {"state": "hi", "questions": {"q": q}})
    assert r.status_code == 400 and r.json()["error"]["code"] == "too_many_options"


def test_raised_option_cap_marks_answer_uncalibrated(make_client):
    c = make_client(max_choice_options=15)
    key = c.post("/admin/keys", json={"name": "k"}, headers={"X-Admin-Secret": "test-secret"}).json()["key"]
    qs = {"big": {**CHOICE, "criteria": [f"o{i}" for i in range(12)]}, "small": CHOICE}
    r = post(c, key, {"state": "hi", "questions": qs})
    assert r.status_code == 200
    answers = r.json()["answers"]
    assert answers["big"]["warning"] == "uncalibrated_confidence"
    assert "warning" not in answers["small"]


def test_boolean_like_choice_labels_warn_but_succeed(client, api_key, caplog):
    q = {**CHOICE, "criteria": {"yes": "the user agrees", "no": "the user disagrees"}}
    r = post(client, api_key, {"state": "hi", "questions": {"agree": q}})
    assert r.status_code == 200
    assert "boolean" in caplog.text
    log = client.get("/admin/logs", headers={"X-Admin-Secret": "test-secret"}).json()[0]
    assert log["warning"] == "boolean_like_choice_labels:agree"


def test_choice_none_descriptions_are_passed_through(client, api_key, fake_router):
    q = {**CHOICE, "criteria": {"a": None, "b": "second"}}
    assert post(client, api_key, {"state": "hi", "questions": {"q": q}}).status_code == 200
    assert fake_router.calls[-1]["questions"]["q"]["criteria"] == {"a": None, "b": "second"}


# ------------------------------------------------------------ routing policy

def test_unloaded_model_rejected_by_default(client, api_key):
    r = post(client, api_key, {"state": "Mein Konto wurde zweimal belastet – bitte prüfen", "questions": {"q": NOUL}})
    assert r.status_code == 422
    msg = r.json()["error"]["message"]
    assert "routed to 'multilingual', which is not loaded on this server" in msg


def test_unloaded_model_fallback_warns(make_client):
    router = FakeRouter()
    c = make_client(router=router, unloaded_model_policy="fallback")
    key = c.post("/admin/keys", json={"name": "k"}, headers={"X-Admin-Secret": "test-secret"}).json()["key"]
    r = post(c, key, {"state": "Mein Konto wurde zweimal belastet – bitte prüfen", "questions": {"q": NOUL}})
    assert r.status_code == 200
    data = r.json()
    assert data["warning"] == "language_mismatch"
    assert data["routing"]["model"] == "multilingual" and data["routing"]["served_by"] == "english"
    assert router.calls[-1]["model"] == "english"
    log = c.get("/admin/logs", headers={"X-Admin-Secret": "test-secret"}).json()[0]
    assert log["warning"] == "language_mismatch"


def test_explicit_unloaded_model_always_rejected(make_client):
    c = make_client(unloaded_model_policy="fallback")
    key = c.post("/admin/keys", json={"name": "k"}, headers={"X-Admin-Secret": "test-secret"}).json()["key"]
    r = post(c, key, {"state": "hello", "questions": {"q": NOUL}, "model": "multilingual"})
    assert r.status_code == 422
    assert post(c, key, {"state": "hello", "questions": {"q": NOUL}, "model": "nope"}).status_code == 400


# ------------------------------------------------------------ presets

def test_preset_wraps_string_state(client, api_key, fake_router):
    r = client.post("/v1/presets/triage", json={"state": "I was charged twice"}, headers=auth(api_key))
    assert r.status_code == 200, r.text
    assert "intent" in r.json()["answers"]
    assert fake_router.calls[-1]["state"] == {"message": "I was charged twice"}
    for name in ("guard", "moderation", "router"):
        assert client.post(f"/v1/presets/{name}", json={"state": "hi"}, headers=auth(api_key)).status_code == 200


def test_unknown_preset(client, api_key):
    assert client.post("/v1/presets/nope", json={"state": "hi"}, headers=auth(api_key)).status_code == 404


def test_model_loading_returns_503(make_client, tmp_path):
    from fastapi.testclient import TestClient

    from app.main import create_app
    from .conftest import make_settings

    app = create_app(make_settings(tmp_path), router=None)
    app.state.engine.load = lambda: None  # don't download anything
    c = TestClient(app)
    key = c.post("/admin/keys", json={"name": "k"}, headers={"X-Admin-Secret": "test-secret"}).json()["key"]
    assert c.get("/health").status_code == 503
    assert post(c, key, {"state": "hi", "questions": {"q": NOUL}}).status_code == 503
