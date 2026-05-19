import importlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def test_hash_and_verify_password(monkeypatch):
    monkeypatch.setenv("AUTH_SECRET_KEY", "test_secret")
    auth_module = importlib.import_module("app.auth")
    importlib.reload(auth_module)

    hashed = auth_module.hash_password("abc12345")
    assert hashed != "abc12345"
    assert auth_module.verify_password("abc12345", hashed)


def test_create_access_token_contains_exp(monkeypatch):
    monkeypatch.setenv("AUTH_SECRET_KEY", "test_secret")
    auth_module = importlib.import_module("app.auth")
    importlib.reload(auth_module)

    token = auth_module.create_access_token({"sub": "demo@ucc.edu.co", "role": "admin"})
    payload = auth_module.jwt.decode(token, auth_module.SECRET_KEY, algorithms=[auth_module.ALGORITHM])

    assert payload["sub"] == "demo@ucc.edu.co"
    assert payload["role"] == "admin"
    assert "exp" in payload
