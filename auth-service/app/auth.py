from passlib.context import CryptContext
from jose import jwt, JWTError
from datetime import datetime, timedelta
from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import os

#  CONFIGURACIÓN JWT
SECRET_KEY = os.environ["AUTH_SECRET_KEY"]
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 480  # 8 horas

#  CONFIGURACIÓN HASH
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# SEGURIDAD PARA SWAGGER
security = HTTPBearer()

#  HASH PASSWORD
def hash_password(password: str):
    password = password[:72]
    return pwd_context.hash(password)

#  VERIFICAR PASSWORD
def verify_password(plain_password, hashed_password):
    plain_password = plain_password[:72]
    return pwd_context.verify(plain_password, hashed_password)

#  CREAR TOKEN
def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

#  VALIDAR TOKEN (ESTO ES LO NUEVO)
def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):

    token = credentials.credentials

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload

    except JWTError:
        raise HTTPException(status_code=401, detail="Token inválido")

def verify_admin(user=Depends(verify_token)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="No autorizado")
    return user

def verify_student(user=Depends(verify_token)):
    if user.get("role") not in ["estudiante", "admin"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    return user

def verify_teacher(user=Depends(verify_token)):
    if user.get("role") not in ["docente", "admin"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    return user