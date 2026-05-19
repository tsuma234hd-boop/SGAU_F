from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException
from . import models, schemas
import logging

logger = logging.getLogger(__name__)

def create_student(db: Session, student: schemas.StudentCreate):
    logger.info(f"Creando estudiante: {student.email}, cédula: {student.document_id}")
    try:
        db_student = models.Student(**student.model_dump())
        db.add(db_student)
        db.commit()
        db.refresh(db_student)
        logger.info(f"✓ Estudiante creado con ID {db_student.id}, cédula guardada: {db_student.document_id}")
        return db_student
    except IntegrityError as e:
        db.rollback()
        error_msg = str(e.orig)
        if 'document_id' in error_msg:
            logger.warning(f"Cédula duplicada: {student.document_id}")
            raise HTTPException(status_code=409, detail=f"La cédula {student.document_id} ya está registrada")
        elif 'email' in error_msg:
            logger.warning(f"Email duplicado: {student.email}")
            raise HTTPException(status_code=409, detail=f"El email {student.email} ya está registrado")
        elif 'user_id' in error_msg:
            logger.warning(f"user_id duplicado: {student.user_id}")
            raise HTTPException(status_code=409, detail=f"Este usuario ya está registrado")
        else:
            logger.error(f"Error de integridad: {error_msg}")
            raise HTTPException(status_code=400, detail="Error al registrar: datos duplicados o inválidos")
    except Exception as e:
        db.rollback()
        logger.error(f"Error inesperado al crear estudiante: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error del servidor: {str(e)}")

def get_students(
    db: Session,
    document_id: str | None = None,
    program: str | None = None,
):
    query = db.query(models.Student)
    if document_id:
        query = query.filter(models.Student.document_id == document_id)
    if program:
        query = query.filter(models.Student.program == program)

    students = query.order_by(models.Student.nombre, models.Student.apellido).all()
    logger.info(f"Obteniendo {len(students)} estudiantes")
    for s in students:
        logger.debug(f"  - {s.email}: cédula={s.document_id}")
    return students

def get_student(db: Session, student_id: int):
    return db.query(models.Student).filter(models.Student.id == student_id).first()

def get_student_by_email(db: Session, email: str):
    return db.query(models.Student).filter(models.Student.email == email).first()

def update_student(db: Session, student_id: int, student_data: schemas.StudentUpdate):
    student = db.query(models.Student).filter(models.Student.id == student_id).first()

    if not student:
        return None

    for key, value in student_data.model_dump(exclude_unset=True).items():
        setattr(student, key, value)

    db.commit()
    db.refresh(student)
    return student

def delete_student(db: Session, student_id: int):
    student = db.query(models.Student).filter(models.Student.id == student_id).first()

    if not student:
        return None

    db.delete(student)
    db.commit()
    return student