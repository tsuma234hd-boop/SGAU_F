from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
import requests
from sqlalchemy.orm import Session
from . import crud, schemas
from .database import SessionLocal
from .auth import require_roles, resolve_student_id

router = APIRouter(prefix="/enrollments", tags=["Enrollments"])
ACADEMIC_SERVICE_URL = "http://academic_service:8000"
CURRENT_ENROLLMENT_STATUSES = {"activa", "active", "pendiente"}


def _is_current_enrollment(enrollment) -> bool:
    status = (getattr(enrollment, "status", "") or "").strip().lower()
    return status in CURRENT_ENROLLMENT_STATUSES


def _parse_period(period: str | None) -> tuple[int, int] | None:
    """Parsea período en formato YYYY-1 o YYYY-2."""
    if not period:
        return None
    raw = str(period).strip()
    parts = raw.split("-")
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail="period debe tener formato YYYY-1 o YYYY-2")
    try:
        year = int(parts[0])
        term = int(parts[1])
    except ValueError:
        raise HTTPException(status_code=400, detail="period debe tener formato YYYY-1 o YYYY-2")
    if term not in (1, 2):
        raise HTTPException(status_code=400, detail="period debe tener formato YYYY-1 o YYYY-2")
    return year, term


def _enrollment_period_key(enrollment) -> str | None:
    """Convierte enrollment_date a período YYYY-1/2."""
    enrollment_date = getattr(enrollment, "enrollment_date", None)
    if not isinstance(enrollment_date, datetime):
        return None
    term = 1 if enrollment_date.month <= 6 else 2
    return f"{enrollment_date.year}-{term}"


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _teacher_assigned_course_ids(user: dict) -> set[int]:
    user_id = user.get("user_id")
    token = user.get("token")
    if not user_id or not token:
        raise HTTPException(status_code=403, detail="No se pudo validar identidad del docente")

    headers = {"Authorization": f"Bearer {token}"}
    try:
        teacher_response = requests.get(
            f"{ACADEMIC_SERVICE_URL}/api/teachers/user/{user_id}",
            headers=headers,
            timeout=5,
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=503, detail=f"No se pudo validar docente: {exc}")

    if teacher_response.status_code != 200:
        raise HTTPException(status_code=403, detail="No se encontró el perfil docente")

    teacher = teacher_response.json()
    teacher_id = teacher.get("id")
    if teacher_id is None:
        raise HTTPException(status_code=403, detail="Perfil docente inválido")

    try:
        assignment_response = requests.get(
            f"{ACADEMIC_SERVICE_URL}/api/assignments/teacher/{teacher_id}",
            headers=headers,
            timeout=5,
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=503, detail=f"No se pudo consultar asignaciones del docente: {exc}")

    if assignment_response.status_code != 200:
        raise HTTPException(status_code=403, detail="No se pudieron consultar los cursos asignados")

    assignments = assignment_response.json()
    return {
        int(a.get("course_id"))
        for a in assignments
        if a.get("course_id") is not None
    }


def _ensure_teacher_can_manage_course(user: dict, course_id: int):
    allowed_course_ids = _teacher_assigned_course_ids(user)
    if int(course_id) not in allowed_course_ids:
        raise HTTPException(status_code=403, detail="Solo puedes gestionar matrículas de tus cursos asignados")


@router.post("/", response_model=schemas.EnrollmentResponse)
def create_enrollment(
    enrollment: schemas.EnrollmentCreate,
    user=Depends(require_roles(["estudiante", "admin", "docente"])),
    db: Session = Depends(get_db),
):
    if user.get("role") == "estudiante":
        my_student_id = resolve_student_id(user)
        if enrollment.student_id != my_student_id:
            raise HTTPException(status_code=403, detail="Solo puedes matricularte a ti mismo")

    if user.get("role") == "docente":
        _ensure_teacher_can_manage_course(user, enrollment.course_id)

    try:
        return crud.create_enrollment(db, enrollment, user.get("token"))
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/", response_model=list[schemas.EnrollmentResponse])
def list_enrollments(
    user=Depends(require_roles(["admin"])),
    db: Session = Depends(get_db),
):
    return crud.get_enrollments(db)


@router.post("/me", response_model=schemas.EnrollmentResponse)
def create_my_enrollment(
    payload: dict,
    user=Depends(require_roles(["estudiante"])),
    db: Session = Depends(get_db),
):
    course_id = payload.get("course_id")
    if course_id is None:
        raise HTTPException(status_code=400, detail="course_id es requerido")

    my_student_id = resolve_student_id(user)
    enrollment = schemas.EnrollmentCreate(student_id=my_student_id, course_id=int(course_id))

    try:
        return crud.create_enrollment(db, enrollment, user.get("token"))
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/me", response_model=list[schemas.EnrollmentResponse])
def get_my_enrollments(
    user=Depends(require_roles(["estudiante"])),
    db: Session = Depends(get_db),
):
    my_student_id = resolve_student_id(user)
    return crud.get_enrollments_by_student(db, my_student_id)


@router.get("/me/courses")
def get_my_courses(
    period: str | None = None,
    user=Depends(require_roles(["estudiante"])),
    db: Session = Depends(get_db),
):
    my_student_id = resolve_student_id(user)
    period_filter = _parse_period(period)
    enrollments = [
        e for e in crud.get_enrollments_by_student(db, my_student_id)
        if _is_current_enrollment(e)
    ]

    if period_filter:
        period_key = f"{period_filter[0]}-{period_filter[1]}"
        enrollments = [e for e in enrollments if _enrollment_period_key(e) == period_key]

    headers = {"Authorization": f"Bearer {user.get('token')}"}

    courses = []
    for enrollment in enrollments:
        try:
            response = requests.get(
                f"{ACADEMIC_SERVICE_URL}/api/courses/{enrollment.course_id}",
                headers=headers,
                timeout=5,
            )
            if response.status_code == 200:
                payload = response.json()
                payload["enrollment_status"] = enrollment.status
                payload["enrollment_id"] = enrollment.id
                payload["enrollment_period"] = _enrollment_period_key(enrollment)
                courses.append(payload)
        except requests.RequestException:
            continue

    return {
        "student_id": my_student_id,
        "total_enrollments": len(enrollments),
        "courses": courses,
    }


@router.get("/{enrollment_id}", response_model=schemas.EnrollmentResponse)
def get_enrollment(
    enrollment_id: int,
    user=Depends(require_roles(["estudiante", "admin"])),
    db: Session = Depends(get_db),
):
    enrollment = crud.get_enrollment(db, enrollment_id)
    if not enrollment:
        raise HTTPException(status_code=404, detail="Inscripción no encontrada")

    if user.get("role") == "estudiante":
        my_student_id = resolve_student_id(user)
        if enrollment.student_id != my_student_id:
            raise HTTPException(status_code=403, detail="Solo puedes ver tus inscripciones")

    return enrollment


@router.get("/student/{student_id}", response_model=list[schemas.EnrollmentResponse])
def get_enrollments_by_student(
    student_id: int,
    user=Depends(require_roles(["estudiante", "admin"])),
    db: Session = Depends(get_db),
):
    if user.get("role") == "estudiante":
        my_student_id = resolve_student_id(user)
        if student_id != my_student_id:
            raise HTTPException(status_code=403, detail="Solo puedes ver tus inscripciones")

    return crud.get_enrollments_by_student(db, student_id)


@router.get("/course/{course_id}", response_model=list[schemas.EnrollmentResponse])
def get_enrollments_by_course(
    course_id: int,
    user=Depends(require_roles(["admin", "docente", "system"])),
    db: Session = Depends(get_db),
):
    if user.get("role") == "docente":
        _ensure_teacher_can_manage_course(user, course_id)

    return crud.get_enrollments_by_course(db, course_id)


@router.get("/course/{course_id}/capacity")
def get_course_capacity(
    course_id: int,
    user=Depends(require_roles(["admin", "docente", "estudiante"])),
    db: Session = Depends(get_db),
):
    """Devuelve cupos totales, ocupados y estado del curso."""
    enrolled_count = db.query(crud.models.Enrollment).filter(
        crud.models.Enrollment.course_id == course_id,
        crud.models.Enrollment.status == "activa",
    ).count()

    # Obtener max_students del curso
    token = user.get("token")
    try:
        resp = requests.get(
            f"{ACADEMIC_SERVICE_URL}/api/courses/{course_id}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=5,
        )
        max_students = resp.json().get("max_students") if resp.status_code == 200 else None
    except Exception:
        max_students = None

    if max_students is None:
        status = "abierta"
        available = None
    elif enrolled_count < max_students:
        available = max_students - enrolled_count
        status = "abierta"
    else:
        available = 0
        status = "cerrada"

    return {
        "course_id": course_id,
        "enrolled": enrolled_count,
        "max_students": max_students,
        "available": available,
        "status": status,  # "abierta" | "cerrada"
    }


@router.put("/{enrollment_id}", response_model=schemas.EnrollmentResponse)
def update_enrollment(
    enrollment_id: int,
    enrollment_data: schemas.EnrollmentUpdate,
    user=Depends(require_roles(["admin"])),
    db: Session = Depends(get_db),
):
    enrollment = crud.update_enrollment(db, enrollment_id, enrollment_data)
    if not enrollment:
        raise HTTPException(status_code=404, detail="Inscripción no encontrada")
    return enrollment


@router.delete("/{enrollment_id}")
def delete_enrollment(
    enrollment_id: int,
    user=Depends(require_roles(["admin", "docente"])),
    db: Session = Depends(get_db),
):
    enrollment = crud.get_enrollment(db, enrollment_id)
    if not enrollment:
        raise HTTPException(status_code=404, detail="Inscripción no encontrada")

    if user.get("role") == "docente":
        _ensure_teacher_can_manage_course(user, enrollment.course_id)

    enrollment = crud.delete_enrollment(db, enrollment_id)
    return {"message": "Inscripción eliminada"}
