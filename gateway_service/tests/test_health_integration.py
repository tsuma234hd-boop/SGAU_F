import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from main import app


client = TestClient(app)


def test_health_endpoint_gateway_service():
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["gateway"] == "ok"
    assert "services" in body
