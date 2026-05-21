from datetime import date, datetime, timedelta
import os

import requests
from jose import jwt
from sqlalchemy.orm import Session

from . import models, schemas

ACADEMIC_SERVICE_URL = os.getenv("ACADEMIC_SERVICE_URL", "http://academic_service:8000")
GRADES_SERVICE_URL = os.getenv("GRADES_SERVICE_URL", "http://grades_service:8000")
STUDENT_SERVICE_URL = os.getenv("STUDENT_SERVICE_URL", "http://student_service:8000")
PASSING_SCORE = 3.0
REQUEST_TIMEOUT = 5
SECRET_KEY = os.environ["AUTH_SECRET_KEY"]
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
SERVICE_TOKEN_EXPIRE_MINUTES = 30
SEMESTER_START_DATE = os.getenv("SEMESTER_START_DATE", "2026-02-02")
ENROLLMENT_GRACE_DAYS = int(os.getenv("ENROLLMENT_GRACE_DAYS", "14"))


def _fetch_course(course_id: int, token: str) -> dict:
    headers = {"Authorization": f"Bearer {token}"}
    try:
        response = requests.get(
            f"{ACADEMIC_SERVICE_URL}/api/courses/{course_id}",
            headers=headers,
            timeout=REQUEST_TIMEOUT,
        )
    except requests.RequestException as e:
        raise RuntimeError(f"No se pudo consultar academic_service: {e}")

    if response.status_code == 404:
        raise ValueError("La materia a matricular no existe")
    if response.status_code != 200:
        raise RuntimeError("No se pudo validar la materia en academic_service")
    return response.json()


def _fetch_course_sessions(course_id: int, token: str) -> list[dict]:
    headers = {"Authorization": f"Bearer {token}"}
    try:
        response = requests.get(
            f"{ACADEMIC_SERVICE_URL}/api/schedules/",
            params={"course_id": course_id},
            headers=headers,
            timeout=REQUEST_TIMEOUT,
        )
    except requests.RequestException as e:
        raise RuntimeError(f"No se pudo consultar las clases disponibles: {e}")

    if response.status_code != 200:
        raise RuntimeError("No se pudieron consultar las clases disponibles")

    data = response.json()
    return data if isinstance(data, list) else []


def _parse_semester_start_date() -> date:
    try:
        return date.fromisoformat(SEMESTER_START_DATE)
    except ValueError as exc:
        raise RuntimeError(
            "Configuracion invalida de SEMESTER_START_DATE. Usa formato YYYY-MM-DD."
        ) from exc


def _validate_enrollment_window():
    semester_start = _parse_semester_start_date()
    enrollment_deadline = semester_start + timedelta(days=ENROLLMENT_GRACE_DAYS)
    today = datetime.now().date()
    if today > enrollment_deadline:
        raise ValueError(
            "La ventana de matricula ya cerro. "
            f"El plazo maximo era hasta {enrollment_deadline.isoformat()} "
            f"({ENROLLMENT_GRACE_DAYS} dias despues del inicio del semestre)."
        )


def _resolve_enrollment_session(enrollment: schemas.EnrollmentCreate, token: str) -> dict | None:
    sessions = _fetch_course_sessions(enrollment.course_id, token)
    if not sessions:
        return None

    if enrollment.section_id is None:
        raise ValueError("Debes seleccionar una clase disponible antes de matricular la materia")

    selected_session = next((s for s in sessions if int(s.get("id")) == int(enrollment.section_id)), None)
    if not selected_session:
        raise ValueError("La clase seleccionada no pertenece a la materia elegida")

    return selected_session


def _resolve_schedule_slot(enrollment: schemas.EnrollmentCreate, token: str) -> dict | None:
    session = _resolve_enrollment_session(enrollment, token)
    if session:
        return {
            "day_of_week": session.get("day_of_week"),
            "start_time": session.get("start_time"),
            "end_time": session.get("end_time"),
            "section": session.get("section"),
        }

    course = _fetch_course(enrollment.course_id, token)
    return {
        "day_of_week": course.get("day_of_week"),
        "start_time": course.get("start_time"),
        "end_time": course.get("end_time"),
        "section": None,
    }


def _create_service_token() -> str:
    payload = {
        "sub": "enrollment_service",
        "role": "system",
        "exp": datetime.utcnow() + timedelta(minutes=SERVICE_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def _fetch_student_grades(student_id: int, token: str) -> list[dict]:
    # Intentar primero con el token del usuario (admin/estudiante/docente)
    headers = {"Authorization": f"Bearer {token}"}
    try:
        response = requests.get(
            f"{GRADES_SERVICE_URL}/grades/students/{student_id}/grades",
            headers=headers,
            timeout=REQUEST_TIMEOUT,
        )
    except requests.RequestException as e:
        raise RuntimeError(f"No se pudo consultar grades_service: {e}")

    # Si el rol no tiene permisos en grades_service, usar token interno de sistema.
    if response.status_code == 403:
        service_headers = {"Authorization": f"Bearer {_create_service_token()}"}
        try:
            response = requests.get(
                f"{GRADES_SERVICE_URL}/grades/students/{student_id}/grades",
                headers=service_headers,
                timeout=REQUEST_TIMEOUT,
            )
        except requests.RequestException as e:
            raise RuntimeError(f"No se pudo consultar grades_service con token interno: {e}")

    if response.status_code != 200:
        raise RuntimeError("No se pudieron validar las notas del estudiante")
    data = response.json()
    return data if isinstance(data, list) else []


def _validate_prerequisites(enrollment: schemas.EnrollmentCreate, token: str):
    course = _fetch_course(enrollment.course_id, token)
    prerequisite_ids = course.get("prerequisite_ids") or []
    prerequisite_codes = course.get("prerequisite_codes") or []
    if not prerequisite_ids:
        return

    approved_course_ids = {
        grade.get("course_id")
        for grade in _fetch_student_grades(enrollment.student_id, token)
        if float(grade.get("score") or 0) >= PASSING_SCORE
    }
    missing_pairs = [
        (prereq_id, prerequisite_codes[index] if index < len(prerequisite_codes) else f"Curso {prereq_id}")
        for index, prereq_id in enumerate(prerequisite_ids)
        if prereq_id not in approved_course_ids
    ]
    if missing_pairs:
        missing_codes = ", ".join(code for _, code in missing_pairs)
        raise ValueError(f"No cumple los prerrequisitos para matricular esta materia. Faltan: {missing_codes}")


def _fetch_career_name(career_id: int, token: str) -> str | None:
    """Devuelve el nombre de la carrera dado su ID, o None si falla."""
    headers = {"Authorization": f"Bearer {token}"}
    try:
        response = requests.get(
            f"{ACADEMIC_SERVICE_URL}/api/careers/{career_id}",
            headers=headers,
            timeout=REQUEST_TIMEOUT,
        )
        if response.status_code == 200:
            return response.json().get("name")
    except requests.RequestException:
        pass
    return None


def _fetch_student_program(student_id: int, token: str) -> str | None:
    """Devuelve el programa/carrera del estudiante, o None si falla."""
    service_token = _create_service_token()
    headers = {"Authorization": f"Bearer {service_token}"}
    try:
        response = requests.get(
            f"{STUDENT_SERVICE_URL}/students/{student_id}",
            headers=headers,
            timeout=REQUEST_TIMEOUT,
        )
        if response.status_code == 200:
            return response.json().get("program")
    except requests.RequestException:
        pass
    return None


def _validate_program(enrollment: schemas.EnrollmentCreate, token: str):
    """Verifica que el programa del estudiante coincida con la carrera del curso."""
    course = _fetch_course(enrollment.course_id, token)
    career_id = course.get("career_id")
    if not career_id:
        return  # curso sin carrera asignada — no bloquear

    career_name = _fetch_career_name(career_id, token)
    if not career_name:
        return  # no se pudo obtener nombre — no bloquear por problema de red

    student_program = _fetch_student_program(enrollment.student_id, token)
    if not student_program or student_program.strip().lower() == "sin programa":
        return  # estudiante sin programa asignado — no bloquear

    if student_program.strip().lower() != career_name.strip().lower():
        raise ValueError(
            f"El estudiante está en '{student_program}' y este curso pertenece a '{career_name}'. "
            "Solo puedes matricular materias de tu carrera."
        )


def _validate_capacity(db: Session, enrollment: schemas.EnrollmentCreate, token: str):
    """Verifica que el curso no esté lleno. Lanza ValueError si no hay cupo."""
    course = _fetch_course(enrollment.course_id, token)
    max_students = course.get("max_students")
    if not max_students:
        return  # sin límite configurado

    current_count = db.query(models.Enrollment).filter(
        models.Enrollment.course_id == enrollment.course_id,
        models.Enrollment.status == "activa",
    ).count()

    if current_count >= max_students:
        raise ValueError(
            f"El curso no tiene cupos disponibles ({current_count}/{max_students}). "
            "Está cerrado para nuevas matrículas."
        )


def _validate_schedule_conflict(db: Session, enrollment: schemas.EnrollmentCreate, token: str):
    """Verifica que el nuevo curso no tenga conflicto de horario con los ya matriculados."""
    new_slot = _resolve_schedule_slot(enrollment, token)
    if not new_slot:
        return

    new_day = new_slot.get("day_of_week")
    new_start = new_slot.get("start_time")
    new_end = new_slot.get("end_time")

    # Si el curso nuevo no tiene horario definido, no podemos validar
    if not new_day or not new_start or not new_end:
        return

    # Obtener matrículas activas del estudiante
    active_enrollments = db.query(models.Enrollment).filter(
        models.Enrollment.student_id == enrollment.student_id,
        models.Enrollment.status.in_(["activa", "pendiente"]),
    ).all()

    for enr in active_enrollments:
        try:
            existing_enrollment = schemas.EnrollmentCreate(
                student_id=enr.student_id,
                course_id=enr.course_id,
                section_id=getattr(enr, "section_id", None),
                status=enr.status,
            )
            existing_slot = _resolve_schedule_slot(existing_enrollment, token)
        except Exception:
            continue

        if not existing_slot:
            continue

        ex_day = existing_slot.get("day_of_week")
        ex_start = existing_slot.get("start_time")
        ex_end = existing_slot.get("end_time")

        if not ex_day or not ex_start or not ex_end:
            continue

        if ex_day == new_day:
            # Verificar solapamiento: nuevo curso se solapa si new_start < ex_end Y new_end > ex_start
            if new_start < ex_end and new_end > ex_start:
                new_course = _fetch_course(enrollment.course_id, token)
                existing_course = _fetch_course(enr.course_id, token)
                raise ValueError(
                    f"Conflicto de horario: '{new_course.get('code')}' ({new_day} {new_start}-{new_end}) "
                    f"se cruza con '{existing_course.get('code')}' ({ex_day} {ex_start}-{ex_end})."
                )


def _validate_new_enrollment(db: Session, enrollment: schemas.EnrollmentCreate, token: str):
    existing = db.query(models.Enrollment).filter(
        models.Enrollment.student_id == enrollment.student_id,
        models.Enrollment.course_id == enrollment.course_id,
    ).first()
    if existing:
        raise ValueError("El estudiante ya está matriculado en esta materia")

    _validate_program(enrollment, token)
    _validate_capacity(db, enrollment, token)
    _validate_schedule_conflict(db, enrollment, token)
    _validate_prerequisites(enrollment, token)


def create_enrollment(db: Session, enrollment: schemas.EnrollmentCreate, token: str):
    _validate_enrollment_window()
    _validate_new_enrollment(db, enrollment, token)
    db_enrollment = models.Enrollment(**enrollment.model_dump())
    db.add(db_enrollment)
    db.commit()
    db.refresh(db_enrollment)
    return db_enrollment


def create_enrollments_atomic(db: Session, enrollments: list[schemas.EnrollmentCreate], token: str):
    if not enrollments:
        return []

    _validate_enrollment_window()
    created: list[models.Enrollment] = []

    try:
        for enrollment in enrollments:
            _validate_new_enrollment(db, enrollment, token)
            db_enrollment = models.Enrollment(**enrollment.model_dump())
            db.add(db_enrollment)
            db.flush()
            created.append(db_enrollment)

        db.commit()
        for item in created:
            db.refresh(item)
        return created
    except Exception:
        db.rollback()
        raise


def get_enrollments(
    db: Session,
    *,
    limit: int | None = None,
    offset: int = 0,
    student_id: int | None = None,
    course_id: int | None = None,
    status: str | None = None,
):
    query = db.query(models.Enrollment)
    if student_id is not None:
        query = query.filter(models.Enrollment.student_id == student_id)
    if course_id is not None:
        query = query.filter(models.Enrollment.course_id == course_id)
    if status:
        query = query.filter(models.Enrollment.status == status)

    query = query.order_by(models.Enrollment.enrollment_date.desc(), models.Enrollment.id.desc())
    if offset:
        query = query.offset(offset)
    if limit is not None:
        query = query.limit(limit)

    return query.all()


def count_enrollments(
    db: Session,
    *,
    student_id: int | None = None,
    course_id: int | None = None,
    status: str | None = None,
):
    query = db.query(models.Enrollment)
    if student_id is not None:
        query = query.filter(models.Enrollment.student_id == student_id)
    if course_id is not None:
        query = query.filter(models.Enrollment.course_id == course_id)
    if status:
        query = query.filter(models.Enrollment.status == status)
    return query.count()


def get_enrollment(db: Session, enrollment_id: int):
    return db.query(models.Enrollment).filter(models.Enrollment.id == enrollment_id).first()


def get_enrollments_by_student(db: Session, student_id: int):
    return db.query(models.Enrollment).filter(models.Enrollment.student_id == student_id).all()


def get_enrollments_by_course(db: Session, course_id: int):
    return db.query(models.Enrollment).filter(models.Enrollment.course_id == course_id).all()


def update_enrollment(db: Session, enrollment_id: int, enrollment_data: schemas.EnrollmentUpdate):
    enrollment = db.query(models.Enrollment).filter(models.Enrollment.id == enrollment_id).first()
    if not enrollment:
        return None

    for key, value in enrollment_data.model_dump(exclude_unset=True).items():
        setattr(enrollment, key, value)

    db.commit()
    db.refresh(enrollment)
    return enrollment


def delete_enrollment(db: Session, enrollment_id: int):
    enrollment = db.query(models.Enrollment).filter(models.Enrollment.id == enrollment_id).first()
    if not enrollment:
        return None
    db.delete(enrollment)
    db.commit()
    return enrollment
