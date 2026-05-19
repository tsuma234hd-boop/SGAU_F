from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from app import models, schemas, auth
from app.database import SessionLocal
from app.auth import verify_token
from app.auth import verify_admin
from app.auth import verify_student
from app.auth import verify_teacher
import requests

router = APIRouter()

# dependencia DB
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.post("/register")
def register(user: schemas.UserCreate, db: Session = Depends(get_db)):
    if user.role == 'docente':
        raise HTTPException(status_code=403, detail='Solo admin puede crear docentes')

    if user.role == 'admin':
        existing_admin = db.query(models.User).filter(models.User.role == 'admin').first()
        if existing_admin:
            raise HTTPException(status_code=403, detail='Ya existe un admin, solo un admin puede crear otro admin')

    if user.document_id:
        existing_document = db.query(models.User).filter(models.User.document_id == user.document_id).first()
        if existing_document:
            raise HTTPException(status_code=409, detail=f"La cédula {user.document_id} ya está registrada")

    hashed_password = auth.hash_password(user.password)
    new_user = models.User(
        email=user.email,
        password=hashed_password,
        role=user.role,
        first_name=user.first_name,
        last_name=user.last_name,
        document_id=user.document_id
    )

    try:
        db.add(new_user)
        db.commit()
        db.refresh(new_user)
    except IntegrityError as e:
        db.rollback()
        error_msg = str(e.orig)
        if 'document_id' in error_msg:
            raise HTTPException(status_code=409, detail=f"La cédula {user.document_id} ya está registrada")
        else:
            raise HTTPException(status_code=409, detail="El email ya está registrado")

    if user.role == 'estudiante':
        try:
            admin_token = auth.create_access_token({
                "sub": "system@auth",
                "role": "admin"
            })
            student_response = requests.post(
                "http://student_service:8000/students/",
                json={
                    "user_id": new_user.id,
                    "email": user.email,
                    "nombre": user.first_name or "",
                    "apellido": user.last_name or "",
                    "document_id": user.document_id or None,
                    "program": "Sin programa"
                },
                headers={
                    "Authorization": f"Bearer {admin_token}",
                    "Content-Type": "application/json"
                },
                timeout=10
            )

            if student_response.status_code != 200:
                db.delete(new_user)
                db.commit()
                detail = f"No se pudo crear el estudiante en student_service ({student_response.status_code})"
                try:
                    data = student_response.json()
                    if isinstance(data, dict) and data.get("detail"):
                        detail = data.get("detail")
                except Exception:
                    pass
                raise HTTPException(status_code=student_response.status_code, detail=detail)
        except Exception as e:
            if not isinstance(e, HTTPException):
                db.delete(new_user)
                db.commit()
                raise HTTPException(status_code=502, detail=f"Error conectando con student_service: {str(e)}")
            raise

    return {"mensaje": "usuario creado exitosamente", "user_id": new_user.id}

@router.post("/create-user")
def create_user(user: schemas.UserCreate, db: Session = Depends(get_db), current_user=Depends(verify_admin)):
    if user.role == 'docente' and not (user.first_name and user.last_name and user.document_id):
        raise HTTPException(status_code=400, detail='Docente debe incluir nombre, apellido y cédula')

    if user.document_id:
        existing_document = db.query(models.User).filter(models.User.document_id == user.document_id).first()
        if existing_document:
            raise HTTPException(status_code=409, detail=f"La cédula {user.document_id} ya está registrada")

    hashed_password = auth.hash_password(user.password)
    new_user = models.User(
        email=user.email,
        password=hashed_password,
        role=user.role,
        first_name=user.first_name,
        last_name=user.last_name,
        document_id=user.document_id
    )

    try:
        db.add(new_user)
        db.commit()
        db.refresh(new_user)
    except IntegrityError as e:
        db.rollback()
        error_msg = str(e.orig)
        if 'document_id' in error_msg:
            raise HTTPException(status_code=409, detail=f"La cédula {user.document_id} ya está registrada")
        else:
            raise HTTPException(status_code=409, detail="El email ya está registrado")

    return {"mensaje": "usuario creado exitosamente", "user_id": new_user.id}

#login
@router.post("/login")
def login(user: schemas.UserLogin, db: Session = Depends(get_db)):

    db_user = db.query(models.User).filter(models.User.email == user.email).first()

    if not db_user:
        raise HTTPException(status_code=400, detail="Usuario no existe")

    if not auth.verify_password(user.password, db_user.password):
        raise HTTPException(status_code=400, detail="Contraseña incorrecta")

    token = auth.create_access_token({
        "sub": db_user.email,
        "role": db_user.role,
        "user_id": db_user.id
        })

    return {
        "access_token": token,
        "token_type": "bearer",
        "role": db_user.role,
        "user_id": db_user.id
    }


@router.put("/me")
def update_me(payload: schemas.UserSelfUpdate, db: Session = Depends(get_db), current_user=Depends(verify_token)):
    user_id = current_user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token inválido")

    db_user = db.query(models.User).filter(models.User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    changed = False

    if payload.first_name is not None:
        db_user.first_name = payload.first_name.strip() or None
        changed = True

    if payload.last_name is not None:
        db_user.last_name = payload.last_name.strip() or None
        changed = True

    if payload.new_password is not None:
        if not auth.verify_password(payload.current_password or "", db_user.password):
            raise HTTPException(status_code=400, detail="Contraseña actual incorrecta")
        db_user.password = auth.hash_password(payload.new_password)
        changed = True

    if changed:
        db.commit()
        db.refresh(db_user)

    return {
        "mensaje": "Perfil actualizado",
        "email": db_user.email,
        "first_name": db_user.first_name,
        "last_name": db_user.last_name,
        "role": db_user.role,
    }

@router.get("/profile")
def profile(db: Session = Depends(get_db), user=Depends(verify_token)):
    user_id = user.get("user_id")
    db_user = db.query(models.User).filter(models.User.id == user_id).first() if user_id else None
    return {
        "mensaje": "Acceso permitido",
        "usuario": {
            **user,
            "email": getattr(db_user, "email", None),
            "first_name": getattr(db_user, "first_name", None),
            "last_name": getattr(db_user, "last_name", None),
            "document_id": getattr(db_user, "document_id", None),
        }
    }

@router.get("/admin")
def admin_route(user=Depends(verify_admin)):
    return {"mensaje": "Bienvenido admin"}

@router.get("/student-profile")
def student_profile(user=Depends(verify_student)):
    return {"mensaje": "Perfil de estudiante", "usuario": user}

@router.get("/teacher-profile")
def teacher_profile(user=Depends(verify_teacher)):
    return {"mensaje": "Perfil de docente", "usuario": user}

@router.get("/admin-profile")
def admin_profile(user=Depends(verify_admin)):
    return {"mensaje": "Perfil de admin", "usuario": user}

@router.get("/test-student")
def test_student():
    try:
        response = requests.get("http://student_service:8001/")
        return response.json()
    except Exception as e:
        return {"error": str(e)}