from collections.abc import Callable
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
import os

SECRET_KEY = os.environ["AUTH_SECRET_KEY"]
ALGORITHM = "HS256"

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


def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    # Compatibilidad con código previo.
    return get_current_user(credentials)