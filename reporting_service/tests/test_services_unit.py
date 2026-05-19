import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.services as services


class DummyResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


def test_safe_get_returns_empty_dict_on_exception(monkeypatch):
    def fake_get(*args, **kwargs):
        raise RuntimeError("network error")

    monkeypatch.setattr(services.requests, "get", fake_get)
    result = services._safe_get("http://service/test", "token")
    assert result == {}


def test_get_student_average_uses_mocked_grades(monkeypatch):
    monkeypatch.setattr(
        services,
        "_safe_get",
        lambda *args, **kwargs: [{"score": 4.0}, {"score": 3.0}, {"score": 5.0}],
    )

    result = services.get_student_average(99, "token")
    assert result["student_id"] == 99
    assert result["average"] == 4.0
    assert len(result["grades"]) == 3


def test_safe_get_returns_json_when_200(monkeypatch):
    monkeypatch.setattr(
        services.requests,
        "get",
        lambda *args, **kwargs: DummyResponse(200, {"ok": True}),
    )

    result = services._safe_get("http://service/test", "token")
    assert result == {"ok": True}
