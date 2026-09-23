"""The engine against the real laya.Router (routing, .loaded, predict) with a stand-in agent
attached, so no model is downloaded and torch is not needed."""
from app.config import Settings
from app.engine import Engine


class StubAgent:
    def system_one(self, state, questions, **_):
        return {"answers": {q: {"type": d["type"], "confidence": 0.9} for q, d in questions.items()},
                "usage": {"input_tokens": 7, "output_tokens": 0}}


def make_engine(tmp_path, **kw):
    from laya import Router

    router = Router(max_loaded=1)
    router.attach("english", StubAgent())
    return Engine(Settings(database_url=f"sqlite:///{tmp_path}/x.db", **kw), router=router)


QS = {"refund": {"type": "noul", "instructions": "Does `message` ask for money back?"}}


def test_english_text_runs_on_real_router(tmp_path):
    engine = make_engine(tmp_path)
    assert engine.loaded_models() == ["english"]
    out = engine.decide({"message": "I was charged twice, please refund me"}, QS)
    assert out.model == "english"
    assert out.result["routing"]["model"] == "english" and out.result["routing"]["served_by"] == "english"
    assert out.result["answers"]["refund"]["type"] == "noul"


def test_german_text_rejected_on_real_router(tmp_path):
    import pytest

    from app.errors import HubError

    engine = make_engine(tmp_path)
    with pytest.raises(HubError) as exc:
        engine.decide({"message": "Mein Konto wurde zweimal belastet. Bitte erstatten Sie mir den Betrag zurück."}, QS)
    assert exc.value.status == 422
    assert "routed to 'multilingual', which is not loaded on this server" in exc.value.message


def test_german_text_fallback_on_real_router(tmp_path):
    engine = make_engine(tmp_path, unloaded_model_policy="fallback")
    out = engine.decide({"message": "Mein Konto wurde zweimal belastet. Bitte erstatten Sie mir den Betrag zurück."}, QS)
    assert out.result["warning"] == "language_mismatch" and out.model == "english"
