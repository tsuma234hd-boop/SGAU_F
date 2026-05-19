from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException
import models, schemas
import logging

logger = logging.getLogger(__name__)

VALID_ROOM_RANGES = [(200, 220), (300, 320), (400, 420), (500, 520)]


def _resolve_prerequisites(db: Session, prerequisite_ids: list[int] | None):
    if not prerequisite_ids:
        return []

    unique_ids = list(dict.fromkeys(prerequisite_ids))
    prerequisites = db.query(models.Course).filter(models.Course.id.in_(unique_ids)).all()
    found_ids = {course.id for course in prerequisites}
    missing_ids = [course_id for course_id in unique_ids if course_id not in found_ids]
    if missing_ids:
        raise ValueError(f"Prerrequisitos no encontrados: {', '.join(str(course_id) for course_id in missing_ids)}")
    return prerequisites

def _time_to_minutes(time_str: str | None) -> int | None:
    if not time_str or ":" not in time_str:
        return None
    hours, minutes = time_str.split(":", 1)
    return int(hours) * 60 + int(minutes)

def _is_valid_room(room_value: str | None) -> bool:
    if not room_value:
        return False
    try:
        room_num = int(room_value)
    except ValueError:
        return False

    return any(start <= room_num <= end for start, end in VALID_ROOM_RANGES)

def _has_schedule_conflict(db: Session, day_of_week: str | None, start_time: str | None, end_time: str | None, location: str | None, ignore_course_id: int | None = None):
    if not day_of_week or not start_time or not end_time or not location:
        return None

    query = db.query(models.Course).filter(
        models.Course.day_of_week == day_of_week,
        models.Course.location == location
    )
    if ignore_course_id is not None:
        query = query.filter(models.Course.id != ignore_course_id)

    start_m = _time_to_minutes(start_time)
    end_m = _time_to_minutes(end_time)
    if start_m is None or end_m is None:
        return None

    for course in query.all():
        existing_start = _time_to_minutes(course.start_time)
        existing_end = _time_to_minutes(course.end_time)
        if existing_start is None or existing_end is None:
            continue

        # Solapamiento de intervalos [start, end)
        if start_m < existing_end and existing_start < end_m:
            return course

    return None

# ── Courses ──
def create_course(db: Session, course: schemas.CourseCreate):
    schedule_text = course.schedule
    if not schedule_text and course.day_of_week and course.start_time and course.end_time:
        schedule_text = f"{course.day_of_week} {course.start_time}-{course.end_time} - {course.location}"

    if not _is_valid_room(course.location):
        raise ValueError("El salón debe estar en los rangos: 200-220, 300-320, 400-420 o 500-520")

    conflict = _has_schedule_conflict(db, course.day_of_week, course.start_time, course.end_time, course.location)
    if conflict:
        raise ValueError(
            f"El salón {course.location} ya está ocupado el {course.day_of_week} de {conflict.start_time} a {conflict.end_time}"
        )

    db_course = models.Course(
        code=course.code,
        name=course.name,
        credits=course.credits,
        semester=course.semester,
        schedule=schedule_text,
        career_id=course.career_id,
        day_of_week=course.day_of_week,
        start_time=course.start_time,
        end_time=course.end_time,
        location=course.location,
        max_students=course.max_students,
    )
    db_course.prerequisites = _resolve_prerequisites(db, course.prerequisites)
    db.add(db_course)
    db.commit()
    db.refresh(db_course)
    return db_course

def create_career(db: Session, career: schemas.CareerCreate):
    db_career = models.Career(
        code=career.code,
        name=career.name,
        description=career.description,
    )
    db.add(db_career)
    db.commit()
    db.refresh(db_career)
    return db_career

def get_courses(db: Session, skip: int = 0, limit: int = 100, career_id: int | None = None):
    query = db.query(models.Course)
    if career_id is not None:
        query = query.filter(models.Course.career_id == career_id)
    query = query.order_by(models.Course.career_id, models.Course.semester, models.Course.name)
    return query.offset(skip).limit(limit).all()

def get_career(db: Session, career_id: int):
    return db.query(models.Career).filter(models.Career.id == career_id).first()

def get_careers(db: Session):
    return db.query(models.Career).all()

def get_course(db: Session, course_id: int):
    return db.query(models.Course).filter(models.Course.id == course_id).first()

def update_course(db: Session, course_id: int, course_data: schemas.CourseUpdate):
    course = db.query(models.Course).filter(models.Course.id == course_id).first()
    if not course:
        return None

    update_data = course_data.model_dump(exclude_unset=True)

    target_day = update_data.get("day_of_week", course.day_of_week)
    target_start = update_data.get("start_time", course.start_time)
    target_end = update_data.get("end_time", course.end_time)
    target_location = update_data.get("location", course.location)

    if "location" in update_data and not _is_valid_room(target_location):
        raise ValueError("El salón debe estar en los rangos: 200-220, 300-320, 400-420 o 500-520")

    conflict = _has_schedule_conflict(db, target_day, target_start, target_end, target_location, ignore_course_id=course_id)
    if conflict:
        raise ValueError(
            f"El salón {target_location} ya está ocupado el {target_day} de {conflict.start_time} a {conflict.end_time}"
        )

    for key, value in update_data.items():
        if key == "prerequisites":
            continue
        setattr(course, key, value)

    if "prerequisites" in update_data:
        course.prerequisites = _resolve_prerequisites(db, update_data["prerequisites"])

    if "schedule" not in update_data and {
        "day_of_week", "start_time", "end_time", "location"
    }.issubset(update_data.keys()):
        course.schedule = f"{course.day_of_week} {course.start_time}-{course.end_time} - {course.location}"

    db.commit()
    db.refresh(course)
    return course

def delete_course(db: Session, course_id: int):
    course = db.query(models.Course).filter(models.Course.id == course_id).first()
    if not course:
        return None

    db.delete(course)
    db.commit()
    return course

# ── Teachers ──
def create_teacher(db: Session, teacher: schemas.TeacherCreate):
    name = teacher.name
    if not name and teacher.first_name and teacher.last_name:
        name = f"{teacher.first_name} {teacher.last_name}".strip()

    try:
        db_teacher = models.Teacher(
            user_id=teacher.user_id,
            email=teacher.email,
            first_name=teacher.first_name,
            last_name=teacher.last_name,
            name=name,
            document_id=teacher.document_id,
            career_code=teacher.career_code,
        )
        db.add(db_teacher)
        db.commit()
        db.refresh(db_teacher)
        logger.info(f"✓ Docente creado con ID {db_teacher.id}, cédula: {db_teacher.document_id}")
        return db_teacher
    except IntegrityError as e:
        db.rollback()
        error_msg = str(e.orig)
        if 'document_id' in error_msg:
            logger.warning(f"Cédula duplicada: {teacher.document_id}")
            raise HTTPException(status_code=409, detail=f"La cédula {teacher.document_id} ya está registrada")
        elif 'email' in error_msg:
            logger.warning(f"Email duplicado: {teacher.email}")
            raise HTTPException(status_code=409, detail=f"El email {teacher.email} ya está registrado")
        elif 'user_id' in error_msg:
            logger.warning(f"user_id duplicado: {teacher.user_id}")
            raise HTTPException(status_code=409, detail=f"Este usuario ya está registrado como docente")
        else:
            logger.error(f"Error de integridad: {error_msg}")
            raise HTTPException(status_code=400, detail="Error al registrar: datos duplicados o inválidos")
    except Exception as e:
        db.rollback()
        logger.error(f"Error inesperado al crear docente: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error del servidor: {str(e)}")


def get_teacher(db: Session, teacher_id: int):
    teacher = db.query(models.Teacher).filter(models.Teacher.id == teacher_id).first()
    if not teacher:
        return None
    _attach_teacher_career_codes(db, [teacher])
    return teacher


def get_teacher_by_user_id(db: Session, user_id: int):
    teacher = db.query(models.Teacher).filter(models.Teacher.user_id == user_id).first()
    if not teacher:
        return None
    _attach_teacher_career_codes(db, [teacher])
    return teacher


def update_teacher(db: Session, teacher_id: int, teacher_data: schemas.TeacherUpdate):
    teacher = db.query(models.Teacher).filter(models.Teacher.id == teacher_id).first()
    if not teacher:
        return None

    try:
        payload = teacher_data.model_dump(exclude_unset=True)
        for key, value in payload.items():
            setattr(teacher, key, value)

        if not teacher.name:
            full_name = f"{teacher.first_name or ''} {teacher.last_name or ''}".strip()
            teacher.name = full_name or teacher.name

        db.commit()
        db.refresh(teacher)
        _attach_teacher_career_codes(db, [teacher])
        logger.info(f"✓ Docente {teacher_id} actualizado")
        return teacher
    except IntegrityError as e:
        db.rollback()
        error_msg = str(e.orig)
        if 'document_id' in error_msg:
            logger.warning(f"Cédula duplicada al actualizar: {teacher.document_id}")
            raise HTTPException(status_code=409, detail=f"La cédula {teacher.document_id} ya está registrada")
        elif 'email' in error_msg:
            logger.warning(f"Email duplicado al actualizar: {teacher.email}")
            raise HTTPException(status_code=409, detail=f"El email {teacher.email} ya está registrado")
        else:
            logger.error(f"Error de integridad al actualizar: {error_msg}")
            raise HTTPException(status_code=400, detail="Error al actualizar: datos duplicados")
    except Exception as e:
        db.rollback()
        logger.error(f"Error inesperado al actualizar docente: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error del servidor: {str(e)}")


def _attach_teacher_career_codes(db: Session, teachers: list[models.Teacher]):
    if not teachers:
        return

    teacher_ids = [t.id for t in teachers if t and t.id is not None]
    if not teacher_ids:
        return

    rows = (
        db.query(models.Assignment.teacher_id, models.Career.code)
        .join(models.Course, models.Course.id == models.Assignment.course_id)
        .join(models.Career, models.Career.id == models.Course.career_id)
        .filter(models.Assignment.teacher_id.in_(teacher_ids))
        .distinct()
        .all()
    )

    by_teacher: dict[int, list[str]] = {teacher_id: [] for teacher_id in teacher_ids}
    for teacher_id, career_code in rows:
        if teacher_id is not None and career_code:
            by_teacher.setdefault(teacher_id, []).append(career_code)

    for teacher in teachers:
        combined_codes = set(by_teacher.get(teacher.id, []))
        if getattr(teacher, "career_code", None):
            combined_codes.add(teacher.career_code)
        teacher.career_codes = sorted(combined_codes)


def get_teachers(
    db: Session,
    document_id: str | None = None,
    career_code: str | None = None,
    course_id: int | None = None,
    name: str | None = None,
):
    query = db.query(models.Teacher)
    if document_id:
        query = query.filter(models.Teacher.document_id == document_id)
    if name:
        search_value = f"%{name}%"
        query = query.filter(
            (
                models.Teacher.name.ilike(search_value)
                | models.Teacher.first_name.ilike(search_value)
                | models.Teacher.last_name.ilike(search_value)
            )
        )
    if course_id:
        # JOIN a través de Assignment → Course → Career
        query = query.join(models.Assignment, models.Assignment.teacher_id == models.Teacher.id)
        query = query.join(models.Course, models.Course.id == models.Assignment.course_id)
        if course_id:
            query = query.filter(models.Course.id == course_id)
        query = query.distinct()
    teachers = query.order_by(models.Teacher.name).all()
    _attach_teacher_career_codes(db, teachers)
    if career_code:
        teachers = [teacher for teacher in teachers if career_code in getattr(teacher, "career_codes", [])]
    return teachers


def get_assignments(db: Session):
    return db.query(models.Assignment).all()


def get_assignments_by_teacher(db: Session, teacher_id: int):
    return db.query(models.Assignment).filter(models.Assignment.teacher_id == teacher_id).all()


def get_assignments_by_course(db: Session, course_id: int):
    return db.query(models.Assignment).filter(models.Assignment.course_id == course_id).all()


def delete_assignment(db: Session, assignment_id: int):
    assignment = db.query(models.Assignment).filter(models.Assignment.id == assignment_id).first()
    if not assignment:
        return None

    db.delete(assignment)
    db.commit()
    return assignment


def update_assignment(db: Session, assignment_id: int, assignment: schemas.AssignmentCreate):
    existing = db.query(models.Assignment).filter(models.Assignment.id == assignment_id).first()
    if not existing:
        return None

    teacher = db.query(models.Teacher).filter(models.Teacher.id == assignment.teacher_id).first()
    if not teacher:
        raise HTTPException(status_code=404, detail="Docente no encontrado")

    course = db.query(models.Course).filter(models.Course.id == assignment.course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Materia no encontrada")

    duplicate = db.query(models.Assignment).filter(
        models.Assignment.id != assignment_id,
        models.Assignment.course_id == assignment.course_id,
        models.Assignment.teacher_id == assignment.teacher_id,
    ).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="Este docente ya está asignado a esta materia")

    if teacher.career_code:
        career = None
        if course.career_id is not None:
            career = db.query(models.Career).filter(models.Career.id == course.career_id).first()

        if not career or career.code != teacher.career_code:
            raise HTTPException(
                status_code=400,
                detail=f"El docente pertenece a la carrera {teacher.career_code} y no puede dictar esta materia",
            )

    existing.teacher_id = assignment.teacher_id
    existing.course_id = assignment.course_id
    db.commit()
    db.refresh(existing)
    return existing

# ── Assignments ──
def assign_teacher(db: Session, assignment: schemas.AssignmentCreate):
    teacher = db.query(models.Teacher).filter(models.Teacher.id == assignment.teacher_id).first()
    if not teacher:
        raise HTTPException(status_code=404, detail="Docente no encontrado")

    course = db.query(models.Course).filter(models.Course.id == assignment.course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Materia no encontrada")

    duplicate = db.query(models.Assignment).filter(
        models.Assignment.course_id == assignment.course_id,
        models.Assignment.teacher_id == assignment.teacher_id,
    ).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="Este docente ya está asignado a esta materia")

    # Regla de negocio: si el docente tiene carrera fija, solo puede dictar materias de esa carrera.
    if teacher.career_code:
        career = None
        if course.career_id is not None:
            career = db.query(models.Career).filter(models.Career.id == course.career_id).first()

        if not career or career.code != teacher.career_code:
            raise HTTPException(
                status_code=400,
                detail=f"El docente pertenece a la carrera {teacher.career_code} y no puede dictar esta materia",
            )

    db_assignment = models.Assignment(course_id=assignment.course_id, teacher_id=assignment.teacher_id)
    db.add(db_assignment)
    db.commit()
    db.refresh(db_assignment)
    return db_assignment


# ── Course Sessions (Horario) ──
def _has_session_conflict(
    db: Session,
    day_of_week: str,
    start_time: str,
    end_time: str,
    classroom: str,
    ignore_id: int | None = None,
) -> models.CourseSession | None:
    query = db.query(models.CourseSession).filter(
        models.CourseSession.day_of_week == day_of_week,
        models.CourseSession.classroom == classroom,
    )
    if ignore_id is not None:
        query = query.filter(models.CourseSession.id != ignore_id)

    start_m = _time_to_minutes(start_time)
    end_m = _time_to_minutes(end_time)
    if start_m is None or end_m is None:
        return None

    for session in query.all():
        s = _time_to_minutes(session.start_time)
        e = _time_to_minutes(session.end_time)
        if s is None or e is None:
            continue
        if start_m < e and s < end_m:
            return session
    return None


def create_session(db: Session, session: schemas.CourseSessionCreate) -> models.CourseSession:
    conflict = _has_session_conflict(
        db, session.day_of_week, session.start_time, session.end_time, session.classroom
    )
    if conflict:
        conflict_course = db.query(models.Course).filter(models.Course.id == conflict.course_id).first()
        conflict_code = conflict_course.code if conflict_course else f"curso {conflict.course_id}"
        raise ValueError(
            f"El salón '{session.classroom}' ya está ocupado el {session.day_of_week} "
            f"de {conflict.start_time} a {conflict.end_time} ({conflict_code})"
        )
    db_session = models.CourseSession(**session.model_dump())
    db.add(db_session)
    db.commit()
    db.refresh(db_session)
    return db_session


def get_sessions(
    db: Session,
    career_id: int | None = None,
    course_id: int | None = None,
) -> list[models.CourseSession]:
    query = db.query(models.CourseSession)
    if course_id is not None:
        query = query.filter(models.CourseSession.course_id == course_id)
    elif career_id is not None:
        course_ids = [
            c.id for c in db.query(models.Course.id).filter(models.Course.career_id == career_id).all()
        ]
        query = query.filter(models.CourseSession.course_id.in_(course_ids))
    return query.all()


def delete_session(db: Session, session_id: int) -> models.CourseSession | None:
    session = db.query(models.CourseSession).filter(models.CourseSession.id == session_id).first()
    if not session:
        return None
    db.delete(session)
    db.commit()
    return session