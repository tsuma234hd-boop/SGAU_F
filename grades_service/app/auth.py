from collections.abc import Callable
from datetime import datetime, timedelta
import os

import requests
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

SECRET_KEY = os.environ["AUTH_SECRET_KEY"]
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = 30
STUDENT_SERVICE_URL = os.getenv("STUDENT_SERVICE_URL", "http://student_service:8000")
ACADEMIC_SERVICE_URL = os.getenv("ACADEMIC_SERVICE_URL", "http://academic_service:8000")

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


def create_service_token(data: dict) -> str:
    payload = data.copy()
    payload["exp"] = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def resolve_student_id(user: dict) -> int:
    headers = {"Authorization": f"Bearer {user.get('token')}"}
    try:
        response = requests.get(f"{STUDENT_SERVICE_URL}/students/me", headers=headers, timeout=5)
    except requests.RequestException as exc:
        raise HTTPException(status_code=503, detail=f"No se pudo validar estudiante: {exc}")

    if response.status_code != 200:
        raise HTTPException(status_code=403, detail="No se pudo validar identidad del estudiante")

    return int(response.json().get("id"))


def resolve_teacher_id(user: dict) -> int:
    user_id = user.get("user_id")
    if user_id is None:
        raise HTTPException(status_code=403, detail="Token de docente incompleto")

    headers = {"Authorization": f"Bearer {user.get('token')}"}
    try:
        response = requests.get(
            f"{ACADEMIC_SERVICE_URL}/api/teachers/user/{user_id}",
            headers=headers,
            timeout=5,
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=503, detail=f"No se pudo validar docente: {exc}")

    if response.status_code != 200:
        raise HTTPException(status_code=403, detail="No se pudo validar identidad del docente")

    return int(response.json().get("id"))


def ensure_teacher_assigned_to_course(user: dict, course_id: int):
    teacher_id = resolve_teacher_id(user)
    headers = {"Authorization": f"Bearer {user.get('token')}"}
    try:
        response = requests.get(
            f"{ACADEMIC_SERVICE_URL}/api/assignments/teacher/{teacher_id}",
            headers=headers,
            timeout=5,
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=503, detail=f"No se pudo validar asignación docente: {exc}")

    if response.status_code != 200:
        raise HTTPException(status_code=403, detail="No se pudieron consultar las asignaciones del docente")

    assigned_course_ids = {int(item.get("course_id")) for item in response.json()}
    if course_id not in assigned_course_ids:
        raise HTTPException(status_code=403, detail="Solo puedes operar en tus cursos asignados")
