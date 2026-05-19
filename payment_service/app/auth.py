from collections.abc import Callable
import os

import requests
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

SECRET_KEY = os.environ["AUTH_SECRET_KEY"]
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
AUTH_SERVICE_URL = os.getenv("AUTH_SERVICE_URL", "http://auth-service:8000")
STUDENT_SERVICE_URL = os.getenv("STUDENT_SERVICE_URL", "http://student_service:8000")

security = HTTPBearer()


def _introspect_with_auth_service(token: str) -> dict | None:
    headers = {"Authorization": f"Bearer {token}"}
    try:
        response = requests.get(f"{AUTH_SERVICE_URL}/auth/profile", headers=headers, timeout=5)
    except requests.RequestException:
        return None

    if response.status_code != 200:
        return None

    data = response.json()
    user = data.get("usuario") if isinstance(data, dict) else None
    if not isinstance(user, dict):
        return None

    user["token"] = token
    return user


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        payload["token"] = token
        return payload
    except JWTError:
        user = _introspect_with_auth_service(token)
        if user:
            return user
        raise HTTPException(status_code=401, detail="Token inválido o expirado")


def require_roles(allowed_roles: list[str]) -> Callable:
    def _role_dependency(user: dict = Depends(get_current_user)):
        if user.get("role") not in allowed_roles:
            raise HTTPException(status_code=403, detail="No autorizado")
        return user

    return _role_dependency


def resolve_student_id(user: dict) -> int:
    headers = {"Authorization": f"Bearer {user.get('token')}"}
    try:
        response = requests.get(f"{STUDENT_SERVICE_URL}/students/me", headers=headers, timeout=5)
    except requests.RequestException as exc:
        raise HTTPException(status_code=503, detail=f"No se pudo validar estudiante: {exc}")

    if response.status_code != 200:
        raise HTTPException(status_code=403, detail="No se pudo validar identidad del estudiante")

    student_id = response.json().get("id")
    if student_id is None:
        raise HTTPException(status_code=403, detail="student_service no devolvio identificador")
    return int(student_id)
