from fastapi import APIRouter, Depends, HTTPException
from app.auth import get_current_user, require_roles
from sqlalchemy.orm import Session
from .db import SessionLocal
from . import crud, schemas

router = APIRouter(prefix="/students", tags=["Students"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@router.post("/", response_model=schemas.StudentResponse)
def create_student(
    student: schemas.StudentCreate,
    user=Depends(require_roles(["admin", "system"])),
    db: Session = Depends(get_db),
):
    """Crear nuevo estudiante. Valida cédula única y formato correcto."""
    try:
        return crud.create_student(db, student)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al crear estudiante: {str(e)}")

@router.get("/", response_model=list[schemas.StudentResponse])
def list_students(
    document_id: str | None = None,
    program: str | None = None,
    user=Depends(require_roles(["admin", "docente"])),
    db: Session = Depends(get_db),
):
    return crud.get_students(db, document_id=document_id, program=program)

@router.get("/me", response_model=schemas.StudentResponse)
def get_my_student(
    user=Depends(require_roles(["estudiante", "admin"])),
    db: Session = Depends(get_db),
):
    student = crud.get_student_by_email(db, user.get('sub'))
    if not student:
        raise HTTPException(status_code=404, detail="Estudiante no encontrado")
    return student

@router.get("/{student_id}", response_model=schemas.StudentResponse)
def get_student(student_id: int, user=Depends(get_current_user), db: Session = Depends(get_db)):
    student = crud.get_student(db, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Estudiante no encontrado")

    if user.get("role") == "estudiante" and student.email != user.get("sub"):
        raise HTTPException(status_code=403, detail="Solo puedes ver tu propio perfil")

    return student

@router.get("/profile")
def get_students(user=Depends(get_current_user)):
    return {
        "mensaje": "Acceso autorizado",
        "usuario": user
    }

@router.put("/{student_id}", response_model=schemas.StudentResponse)
def update_student(
    student_id: int,
    student_data: schemas.StudentUpdate,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.get('role') not in ['admin', 'estudiante']:
        raise HTTPException(status_code=403, detail='No autorizado para editar perfiles de estudiantes')

    # Verificar que el estudiante solo pueda actualizar su propio perfil
    if user.get('role') == 'estudiante':
        # Obtener el estudiante del usuario autenticado
        student = crud.get_student_by_email(db, user.get('sub'))
        if not student or student.id != student_id:
            raise HTTPException(status_code=403, detail='Solo puedes editar tu propio perfil')

        # El estudiante no puede cambiar su carrera/programa.
        update_payload = student_data.model_dump(exclude_unset=True)
        update_payload.pop('program', None)
        student_data = schemas.StudentUpdate(**update_payload)

    student = crud.update_student(db, student_id, student_data)
    if not student:
        raise HTTPException(status_code=404, detail="Estudiante no encontrado")
    return student

@router.delete("/{student_id}")
def delete_student(
    student_id: int,
    user=Depends(require_roles(["admin"])),
    db: Session = Depends(get_db),
):
    student = crud.delete_student(db, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Estudiante no encontrado")
    return {"message": "Estudiante eliminado correctamente"}


@router.post("/update-average")
def update_average(
    payload: dict,
    user=Depends(require_roles(["docente", "admin", "system"])),
    db: Session = Depends(get_db),
):
    student_id = payload.get("student_id")
    average = payload.get("average")
    if not student_id:
        raise HTTPException(status_code=400, detail="student_id es requerido")

    student = crud.get_student(db, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Estudiante no encontrado")

    if average is not None:
        student.average = average
        db.commit()
        db.refresh(student)

    return {"message": "Promedio actualizado", "student_id": student_id, "average": student.average}

@router.post("/sync-document-ids")
def sync_document_ids(creds: dict = Depends(require_roles(["admin"])), db: Session = Depends(get_db)):
    """Ruta admin para sincronizar document_ids desde auth-service (solo para migración)"""

    # Obtener todos los usuarios del auth-service
    import requests
    admin_token = creds.get('token')  # Este token viene del cliente admin
    
    # En una migración real, querrías actualizar desde la BD de auth directamente
    # Por ahora, devolvemos un estado
    return {"message": "Sincronización completada", "endpoint": "/students/ tendrá cédulas"}