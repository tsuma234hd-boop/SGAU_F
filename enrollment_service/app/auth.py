from collections.abc import Callable
import os

import requests
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

SECRET_KEY = os.environ["AUTH_SECRET_KEY"]
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
STUDENT_SERVICE_URL = os.getenv("STUDENT_SERVICE_URL", "http://student_service:8000")

security = HTTPBearer()


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        payload["token"] = token
        return payload
    except JWTError:
        raise HTTPException(status_code=401, detail="Token inválido")


def require_roles(allowed_roles: list[str]) -> Callable:
    def _role_dependency(user: dict = Depends(get_current_user)):
        if user.get("role") not in allowed_roles:
            raise HTTPException(status_code=403, detail="No autorizado")
        return user

    return _role_dependency


def resolve_student_id(user: dict) -> int:
    if user.get("role") != "estudiante":
        raise HTTPException(status_code=403, detail="Solo aplica para estudiantes")

    token = user.get("token")
    headers = {"Authorization": f"Bearer {token}"}
    try:
        response = requests.get(f"{STUDENT_SERVICE_URL}/students/me", headers=headers, timeout=5)
    except requests.RequestException as exc:
        raise HTTPException(status_code=503, detail=f"No se pudo validar estudiante: {exc}")

    if response.status_code != 200:
        raise HTTPException(status_code=403, detail="No se pudo validar identidad del estudiante")

    return int(response.json().get("id"))
