import base64

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from sqlalchemy.orm import Session
from app.db import SessionLocal
from app import schemas, crud
import requests
from app.auth import (
    ACADEMIC_SERVICE_URL,
    create_service_token,
    ensure_teacher_assigned_to_course,
    require_roles,
    resolve_student_id,
    resolve_teacher_id,
)

ENROLLMENT_SERVICE_URL = "http://enrollment_service:8000"

router = APIRouter()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _get_teacher_course_ids(user: dict, db) -> list[int]:
    """Retorna la lista de course_ids asignados al docente autenticado."""
    teacher_id = resolve_teacher_id(user)
    headers = {"Authorization": f"Bearer {user.get('token')}"}
    try:
        resp = requests.get(
            f"{ACADEMIC_SERVICE_URL}/api/assignments/teacher/{teacher_id}",
            headers=headers,
            timeout=5,
        )
    except requests.RequestException:
        return []
    if resp.status_code != 200:
        return []
    return [int(item.get("course_id")) for item in resp.json()]


def _get_enrolled_course_ids(user: dict) -> list[int]:
    headers = {"Authorization": f"Bearer {user.get('token')}"}
    try:
        response = requests.get(f"{ENROLLMENT_SERVICE_URL}/enrollments/me/courses", headers=headers, timeout=5)
    except requests.RequestException as exc:
        raise HTTPException(status_code=503, detail=f"No se pudo consultar matrículas: {exc}")

    if response.status_code != 200:
        raise HTTPException(status_code=403, detail="No se pudieron consultar tus materias matriculadas")

    courses = response.json().get("courses", [])
    return [int(c.get("id")) for c in courses if c.get("id") is not None]

@router.post("/", response_model=schemas.GradeResponse)
def create_grade(
    grade: schemas.GradeCreate,
    user=Depends(require_roles(["admin", "docente"])),
    db: Session = Depends(get_db),
):
    if user.get("role") == "docente":
        ensure_teacher_assigned_to_course(user, grade.course_id)

    new_grade = crud.create_grade(db, grade)

    # Calcular nuevo promedio y notificar a Student Service
    grades = crud.get_grades_by_student(db, grade.student_id)
    avg = sum(g.score for g in grades) / len(grades)
    try:
        service_token = create_service_token({"sub": "grades_service", "role": "system"})
        requests.post(
            "http://student_service:8000/students/update-average",
            json={"student_id": grade.student_id, "average": round(avg, 2)},
            headers={"Authorization": f"Bearer {service_token}"},
            timeout=5
        )
    except Exception as e:
        print(f"No se pudo notificar al student_service: {e}")

    return new_grade


@router.put("/{grade_id}", response_model=schemas.GradeResponse)
def update_grade(
    grade_id: int,
    data: schemas.GradeUpdate,
    user=Depends(require_roles(["admin", "docente"])),
    db: Session = Depends(get_db),
):
    grade = crud.get_grade(db, grade_id)
    if not grade:
        raise HTTPException(status_code=404, detail="Nota no encontrada")

    if user.get("role") == "docente":
        ensure_teacher_assigned_to_course(user, grade.course_id)

    updated = crud.update_grade(db, grade_id, data.score)
    if not updated:
        raise HTTPException(status_code=404, detail="Nota no encontrada")

    # Recalcular promedio y notificar
    grades = crud.get_grades_by_student(db, updated.student_id)
    avg = sum(g.score for g in grades) / len(grades)
    try:
        service_token = create_service_token({"sub": "grades_service", "role": "system"})
        requests.post(
            "http://student_service:8000/students/update-average",
            json={"student_id": updated.student_id, "average": round(avg, 2)},
            headers={"Authorization": f"Bearer {service_token}"},
            timeout=5
        )
    except Exception as e:
        print(f"No se pudo notificar al student_service: {e}")

    return updated


@router.get("/students/{student_id}/grades")
def get_grades_for_student(
    student_id: int,
    user=Depends(require_roles(["admin", "estudiante", "system"])),
    db: Session = Depends(get_db),
):
    if user.get("role") == "estudiante":
        my_student_id = resolve_student_id(user)
        if student_id != my_student_id:
            raise HTTPException(status_code=403, detail="Solo puedes ver tus notas")

    return crud.get_grades_by_student(db, student_id)


@router.get("/me")
def get_my_grades(
    user=Depends(require_roles(["estudiante"])),
    db: Session = Depends(get_db),
):
    my_student_id = resolve_student_id(user)
    return crud.get_grades_by_student(db, my_student_id)


@router.get("/courses/{course_id}/grades")
def get_grades_for_course(
    course_id: int,
    user=Depends(require_roles(["admin", "docente"])),
    db: Session = Depends(get_db),
):
    if user.get("role") == "docente":
        ensure_teacher_assigned_to_course(user, course_id)

    return crud.get_grades_by_course(db, course_id)


@router.get("/students/{student_id}/average")
def calculate_average(
    student_id: int,
    user=Depends(require_roles(["admin", "estudiante"])),
    db: Session = Depends(get_db),
):
    if user.get("role") == "estudiante":
        my_student_id = resolve_student_id(user)
        if student_id != my_student_id:
            raise HTTPException(status_code=403, detail="Solo puedes ver tu promedio")

    grades = crud.get_grades_by_student(db, student_id)

    if not grades:
        return {"student_id": student_id, "average": 0.0, "total_grades": 0}

    avg = round(sum(g.score for g in grades) / len(grades), 2)
    return {"student_id": student_id, "average": avg, "total_grades": len(grades)}


@router.get("/me/average")
def calculate_my_average(
    user=Depends(require_roles(["estudiante"])),
    db: Session = Depends(get_db),
):
    my_student_id = resolve_student_id(user)
    grades = crud.get_grades_by_student(db, my_student_id)

    if not grades:
        return {"student_id": my_student_id, "average": 0.0, "total_grades": 0}

    avg = round(sum(g.score for g in grades) / len(grades), 2)
    return {"student_id": my_student_id, "average": avg, "total_grades": len(grades)}


def _ensure_gradebook_access(gradebook, user):
    if user.get("role") == "docente":
        ensure_teacher_assigned_to_course(user, gradebook.course_id)


def _final_grade_to_response(final_grade, pass_mark: float):
    return {
        "id": final_grade.id,
        "gradebook_id": final_grade.gradebook_id,
        "student_id": final_grade.student_id,
        "auto_score": final_grade.auto_score,
        "manual_score": final_grade.manual_score,
        "final_score": final_grade.final_score,
        "is_manual_override": final_grade.is_manual_override,
        "override_reason": final_grade.override_reason,
        "status": final_grade.status,
        "passed": final_grade.final_score >= pass_mark,
    }


@router.post("/gradebooks", response_model=schemas.GradebookResponse)
def create_gradebook(
    payload: schemas.GradebookCreate,
    user=Depends(require_roles(["admin", "docente"])),
    db: Session = Depends(get_db),
):
    if user.get("role") == "docente":
        ensure_teacher_assigned_to_course(user, payload.course_id)

    teacher_user_id = user.get("user_id") if user.get("role") == "docente" else None
    return crud.create_gradebook(db, payload, teacher_user_id)


@router.get("/gradebooks", response_model=list[schemas.GradebookResponse])
def list_gradebooks(
    period: str | None = None,
    course_id: int | None = None,
    section: str | None = None,
    status: str | None = None,
    user=Depends(require_roles(["admin", "docente"])),
    db: Session = Depends(get_db),
):
    teacher_user_id = user.get("user_id") if user.get("role") == "docente" else None
    gradebooks = crud.list_gradebooks(
        db,
        period=period,
        course_id=course_id,
        section=section,
        status=status,
        teacher_user_id=teacher_user_id,
    )
    if user.get("role") == "docente" and course_id:
        ensure_teacher_assigned_to_course(user, course_id)
    return gradebooks


@router.post("/gradebooks/{gradebook_id}/components", response_model=schemas.GradeComponentResponse)
def create_component(
    gradebook_id: int,
    payload: schemas.GradeComponentCreate,
    user=Depends(require_roles(["admin", "docente"])),
    db: Session = Depends(get_db),
):
    gradebook = crud.get_gradebook(db, gradebook_id)
    if not gradebook:
        raise HTTPException(status_code=404, detail="Libro de calificaciones no encontrado")
    _ensure_gradebook_access(gradebook, user)
    if gradebook.status == "closed":
        raise HTTPException(status_code=400, detail="El libro está cerrado")

    current_weight = crud.get_components_total_weight(db, gradebook_id)
    if (current_weight + payload.weight) > 100.0:
        raise HTTPException(status_code=400, detail="La suma de pesos no puede superar 100")

    return crud.create_component(db, gradebook_id, payload)


@router.get("/gradebooks/{gradebook_id}/components", response_model=list[schemas.GradeComponentResponse])
def list_components(
    gradebook_id: int,
    user=Depends(require_roles(["admin", "docente"])),
    db: Session = Depends(get_db),
):
    gradebook = crud.get_gradebook(db, gradebook_id)
    if not gradebook:
        raise HTTPException(status_code=404, detail="Libro de calificaciones no encontrado")
    _ensure_gradebook_access(gradebook, user)
    return crud.list_components(db, gradebook_id)


@router.post("/gradebooks/{gradebook_id}/items/bulk", response_model=list[schemas.GradeItemResponse])
def upsert_grade_items(
    gradebook_id: int,
    payload: schemas.GradeItemsBulkUpsert,
    user=Depends(require_roles(["admin", "docente"])),
    db: Session = Depends(get_db),
):
    gradebook = crud.get_gradebook(db, gradebook_id)
    if not gradebook:
        raise HTTPException(status_code=404, detail="Libro de calificaciones no encontrado")
    _ensure_gradebook_access(gradebook, user)
    if gradebook.status == "closed":
        raise HTTPException(status_code=400, detail="El libro está cerrado")

    component = crud.get_component(db, payload.component_id)
    if not component or component.gradebook_id != gradebook_id:
        raise HTTPException(status_code=404, detail="Componente no encontrado en este libro")

    return crud.upsert_grade_items(db, gradebook_id, payload.component_id, payload.items)


@router.post("/gradebooks/{gradebook_id}/recalculate", response_model=list[schemas.FinalGradeResponse])
def recalculate_finals(
    gradebook_id: int,
    user=Depends(require_roles(["admin", "docente"])),
    db: Session = Depends(get_db),
):
    gradebook = crud.get_gradebook(db, gradebook_id)
    if not gradebook:
        raise HTTPException(status_code=404, detail="Libro de calificaciones no encontrado")
    _ensure_gradebook_access(gradebook, user)

    total_weight = crud.get_components_total_weight(db, gradebook_id)
    if round(total_weight, 6) != 100.0:
        raise HTTPException(status_code=400, detail="La suma de componentes debe ser exactamente 100")

    finals = crud.recalculate_final_grades(db, gradebook)
    return [_final_grade_to_response(f, gradebook.pass_mark) for f in finals]


@router.get("/gradebooks/{gradebook_id}/finals", response_model=list[schemas.FinalGradeResponse])
def list_finals(
    gradebook_id: int,
    user=Depends(require_roles(["admin", "docente"])),
    db: Session = Depends(get_db),
):
    gradebook = crud.get_gradebook(db, gradebook_id)
    if not gradebook:
        raise HTTPException(status_code=404, detail="Libro de calificaciones no encontrado")
    _ensure_gradebook_access(gradebook, user)
    finals = crud.list_final_grades(db, gradebook_id)
    return [_final_grade_to_response(f, gradebook.pass_mark) for f in finals]


@router.put("/finals/{final_grade_id}/override", response_model=schemas.FinalGradeResponse)
def override_final(
    final_grade_id: int,
    payload: schemas.FinalGradeOverride,
    user=Depends(require_roles(["admin", "docente"])),
    db: Session = Depends(get_db),
):
    final_grade = crud.get_final_grade(db, final_grade_id)
    if not final_grade:
        raise HTTPException(status_code=404, detail="Definitiva no encontrada")

    gradebook = crud.get_gradebook(db, final_grade.gradebook_id)
    if not gradebook:
        raise HTTPException(status_code=404, detail="Libro de calificaciones no encontrado")
    _ensure_gradebook_access(gradebook, user)
    if gradebook.status == "closed":
        raise HTTPException(status_code=400, detail="El libro está cerrado")

    old_score = str(final_grade.final_score)
    updated = crud.override_final_grade(db, final_grade, payload.manual_score, payload.reason)
    crud.create_audit_entry(
        db,
        gradebook_id=gradebook.id,
        action="override",
        actor_user_id=user.get("user_id"),
        final_grade_id=updated.id,
        student_id=updated.student_id,
        old_value=old_score,
        new_value=str(payload.manual_score),
        reason=payload.reason,
    )
    return _final_grade_to_response(updated, gradebook.pass_mark)


@router.patch("/gradebooks/{gradebook_id}/status", response_model=schemas.GradebookResponse)
def update_gradebook_status(
    gradebook_id: int,
    payload: schemas.GradebookStatusUpdate,
    user=Depends(require_roles(["admin", "docente"])),
    db: Session = Depends(get_db),
):
    gradebook = crud.get_gradebook(db, gradebook_id)
    if not gradebook:
        raise HTTPException(status_code=404, detail="Libro de calificaciones no encontrado")
    _ensure_gradebook_access(gradebook, user)

    if payload.status == "closed":
        total_weight = crud.get_components_total_weight(db, gradebook_id)
        if round(total_weight, 6) != 100.0:
            raise HTTPException(status_code=400, detail="No se puede cerrar: los componentes no suman 100")

    old_status = gradebook.status
    updated_gb = crud.set_gradebook_status(db, gradebook, payload.status)
    crud.create_audit_entry(
        db,
        gradebook_id=gradebook_id,
        action="status_change",
        actor_user_id=user.get("user_id"),
        old_value=old_status,
        new_value=payload.status,
    )
    return updated_gb


@router.get("/gradebooks/{gradebook_id}/audit", response_model=list[schemas.GradeAuditResponse])
def get_gradebook_audit(
    gradebook_id: int,
    user=Depends(require_roles(["admin", "docente"])),
    db: Session = Depends(get_db),
):
    """Historial de cambios del libro: overrides manuales y transiciones de estado."""
    gradebook = crud.get_gradebook(db, gradebook_id)
    if not gradebook:
        raise HTTPException(status_code=404, detail="Libro de calificaciones no encontrado")
    _ensure_gradebook_access(gradebook, user)
    return crud.list_audit(db, gradebook_id)


@router.get("/gradebooks/{gradebook_id}/roster")
def get_gradebook_roster(
    gradebook_id: int,
    user=Depends(require_roles(["admin", "docente"])),
    db: Session = Depends(get_db),
):
    """Devuelve los estudiantes matriculados al curso del gradebook, con su definitiva si ya existe."""
    gradebook = crud.get_gradebook(db, gradebook_id)
    if not gradebook:
        raise HTTPException(status_code=404, detail="Libro de calificaciones no encontrado")
    _ensure_gradebook_access(gradebook, user)

    # Obtener matrículas desde enrollment_service
    service_token = create_service_token({"sub": "grades_service", "role": "system"})
    try:
        resp = requests.get(
            f"{ENROLLMENT_SERVICE_URL}/enrollments/course/{gradebook.course_id}",
            headers={"Authorization": f"Bearer {service_token}"},
            timeout=5,
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"No se pudo consultar enrollment_service: {e}")

    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Error consultando matrículas del curso")

    enrollments = resp.json()
    student_ids = [e.get("student_id") for e in enrollments if e.get("student_id")]

    # Cruzar con finales existentes
    finals = crud.list_final_grades(db, gradebook_id)
    finals_map = {f.student_id: f for f in finals}

    # Notas por componente para items
    items = crud.get_grade_items_by_gradebook(db, gradebook_id)
    items_by_student: dict[int, list] = {}
    for item in items:
        items_by_student.setdefault(item.student_id, []).append({
            "component_id": item.component_id,
            "score": item.score,
        })

    result = []
    for sid in student_ids:
        final = finals_map.get(sid)
        result.append({
            "student_id": sid,
            "items": items_by_student.get(sid, []),
            "final_score": final.final_score if final else None,
            "auto_score": final.auto_score if final else None,
            "is_manual_override": final.is_manual_override if final else False,
            "status": final.status if final else "sin_notas",
            "passed": (final.final_score >= gradebook.pass_mark) if final else None,
        })

    return {
        "gradebook_id": gradebook_id,
        "course_id": gradebook.course_id,
        "period": gradebook.period,
        "section": gradebook.section,
        "pass_mark": gradebook.pass_mark,
        "total_enrolled": len(student_ids),
        "roster": result,
    }


@router.get("/gradebooks/{gradebook_id}/items")
def get_gradebook_items(
    gradebook_id: int,
    student_id: int | None = None,
    user=Depends(require_roles(["admin", "docente"])),
    db: Session = Depends(get_db),
):
    """Lista notas por componente del libro, filtrable por estudiante."""
    gradebook = crud.get_gradebook(db, gradebook_id)
    if not gradebook:
        raise HTTPException(status_code=404, detail="Libro de calificaciones no encontrado")
    _ensure_gradebook_access(gradebook, user)

    items = crud.get_grade_items_by_gradebook(db, gradebook_id)
    if student_id:
        items = [i for i in items if i.student_id == student_id]
    return items


@router.get("/me/detail")
def get_my_grades_detail(
    period: str | None = None,
    user=Depends(require_roles(["estudiante"])),
    db: Session = Depends(get_db),
):
    """Vista estudiante: notas por componente + definitivas, con detalle de cálculo."""
    my_student_id = resolve_student_id(user)

    query_args = {}
    if period:
        query_args["period"] = period

    gradebooks = crud.list_gradebooks(db, **query_args)
    result = []

    for gb in gradebooks:
        finals = crud.list_final_grades(db, gb.id)
        student_final = next((f for f in finals if f.student_id == my_student_id), None)
        if not student_final:
            continue

        components = crud.list_components(db, gb.id)
        items = crud.get_grade_items_by_gradebook(db, gb.id)
        my_items = [i for i in items if i.student_id == my_student_id]
        items_map = {i.component_id: i.score for i in my_items}

        component_detail = [
            {
                "component_id": c.id,
                "name": c.name,
                "weight": c.weight,
                "score": items_map.get(c.id),
                "weighted_contribution": round(
                    (items_map.get(c.id) or 0) * (c.weight / 100.0), 2
                ),
            }
            for c in components
        ]

        result.append({
            "gradebook_id": gb.id,
            "course_id": gb.course_id,
            "period": gb.period,
            "section": gb.section,
            "status": gb.status,
            "pass_mark": gb.pass_mark,
            "components": component_detail,
            "auto_score": student_final.auto_score,
            "final_score": student_final.final_score,
            "is_manual_override": student_final.is_manual_override,
            "override_reason": student_final.override_reason,
            "passed": student_final.final_score >= gb.pass_mark,
        })

    return {"student_id": my_student_id, "period": period, "courses": result}


@router.get("/courses/{course_id}/definitivas")
def get_course_definitivas(
    course_id: int,
    user=Depends(require_roles(["admin", "docente"])),
    db: Session = Depends(get_db),
):
    """Nota final de cada estudiante según buzones con peso > 0 del curso."""
    if user.get("role") == "docente":
        ensure_teacher_assigned_to_course(user, course_id)
    return crud.get_course_definitivas(db, course_id)


@router.post("/buzones", response_model=schemas.ActivityBoxResponse)
def create_activity_box(
    payload: schemas.ActivityBoxCreate,
    user=Depends(require_roles(["admin", "docente"])),
    db: Session = Depends(get_db),
):
    if user.get("role") == "docente":
        ensure_teacher_assigned_to_course(user, payload.course_id)
    return crud.create_activity_box(db, payload, teacher_user_id=user.get("user_id"))


@router.get("/buzones", response_model=list[schemas.ActivityBoxResponse])
def list_activity_boxes(
    course_id: int | None = None,
    user=Depends(require_roles(["admin", "docente", "estudiante"])),
    db: Session = Depends(get_db),
):
    role = user.get("role")
    if role == "docente":
        if course_id:
            ensure_teacher_assigned_to_course(user, course_id)
        return crud.list_activity_boxes(db, course_id=course_id, teacher_user_id=user.get("user_id"))

    if role == "estudiante":
        enrolled_course_ids = _get_enrolled_course_ids(user)
        if course_id is not None and course_id not in enrolled_course_ids:
            raise HTTPException(status_code=403, detail="Solo puedes ver buzones de tus materias")
        course_ids = [course_id] if course_id is not None else enrolled_course_ids
        return crud.list_activity_boxes(db, course_ids=course_ids)

    return crud.list_activity_boxes(db, course_id=course_id)


@router.delete("/buzones/{box_id}", status_code=204)
def delete_activity_box(
    box_id: int,
    user=Depends(require_roles(["admin", "docente"])),
    db: Session = Depends(get_db),
):
    box = crud.get_activity_box(db, box_id)
    if not box:
        raise HTTPException(status_code=404, detail="Buzón no encontrado")

    if user.get("role") == "docente" and box.teacher_user_id != user.get("user_id"):
        raise HTTPException(status_code=403, detail="No puedes eliminar este buzón")

    crud.delete_activity_box(db, box)


@router.post("/buzones/{box_id}/submit", response_model=schemas.ActivitySubmissionResponse)
async def submit_activity(
    box_id: int,
    student_comment: str | None = Form(default=None),
    file: UploadFile | None = File(default=None),
    user=Depends(require_roles(["estudiante"])),
    db: Session = Depends(get_db),
):
    box = crud.get_activity_box(db, box_id)
    if not box:
        raise HTTPException(status_code=404, detail="Buzón no encontrado")

    enrolled_course_ids = _get_enrolled_course_ids(user)
    if box.course_id not in enrolled_course_ids:
        raise HTTPException(status_code=403, detail="Solo puedes enviar en tus materias")

    my_student_id = resolve_student_id(user)
    file_name = None
    file_content = None
    if file and file.filename:
        raw = await file.read()
        if len(raw) > 2 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Archivo muy grande (máx 2MB)")
        file_name = file.filename
        file_content = base64.b64encode(raw).decode("utf-8")

    return crud.upsert_activity_submission(
        db,
        box_id=box.id,
        student_id=my_student_id,
        student_comment=student_comment,
        file_name=file_name,
        file_content=file_content,
    )


@router.get("/buzones/{box_id}/submissions", response_model=list[schemas.ActivitySubmissionResponse])
def list_activity_submissions(
    box_id: int,
    user=Depends(require_roles(["admin", "docente"])),
    db: Session = Depends(get_db),
):
    box = crud.get_activity_box(db, box_id)
    if not box:
        raise HTTPException(status_code=404, detail="Buzón no encontrado")
    if user.get("role") == "docente" and box.teacher_user_id != user.get("user_id"):
        raise HTTPException(status_code=403, detail="No puedes ver envíos de este buzón")
    return crud.list_activity_submissions(db, box_id)


@router.get("/buzones/{box_id}/my-submission", response_model=schemas.ActivitySubmissionResponse)
def get_my_activity_submission(
    box_id: int,
    user=Depends(require_roles(["estudiante"])),
    db: Session = Depends(get_db),
):
    my_student_id = resolve_student_id(user)
    submission = crud.get_my_activity_submission(db, box_id=box_id, student_id=my_student_id)
    if not submission:
        raise HTTPException(status_code=404, detail="No has enviado actividad")
    return submission


@router.put("/submissions/{submission_id}/grade", response_model=schemas.ActivitySubmissionResponse)
def grade_activity_submission(
    submission_id: int,
    payload: schemas.ActivitySubmissionGrade,
    user=Depends(require_roles(["admin", "docente"])),
    db: Session = Depends(get_db),
):
    submission = crud.get_activity_submission(db, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Entrega no encontrada")

    box = crud.get_activity_box(db, submission.box_id)
    if not box:
        raise HTTPException(status_code=404, detail="Buzón no encontrado")

    if user.get("role") == "docente" and box.teacher_user_id != user.get("user_id"):
        raise HTTPException(status_code=403, detail="No puedes calificar esta entrega")

    return crud.grade_activity_submission(db, submission, payload.score, payload.teacher_comment)


@router.get("/submissions/{submission_id}/file")
def download_activity_file(
    submission_id: int,
    user=Depends(require_roles(["admin", "docente", "estudiante"])),
    db: Session = Depends(get_db),
):
    submission = crud.get_activity_submission(db, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Entrega no encontrada")

    box = crud.get_activity_box(db, submission.box_id)
    if not box:
        raise HTTPException(status_code=404, detail="Buzón no encontrado")

    role = user.get("role")
    if role == "estudiante":
        my_student_id = resolve_student_id(user)
        if submission.student_id != my_student_id:
            raise HTTPException(status_code=403, detail="No puedes descargar este archivo")
    if role == "docente" and box.teacher_user_id != user.get("user_id"):
        raise HTTPException(status_code=403, detail="No puedes descargar este archivo")

    if not submission.file_content:
        raise HTTPException(status_code=404, detail="La entrega no tiene archivo")

    raw = base64.b64decode(submission.file_content)
    file_name = submission.file_name or "entrega.bin"
    return Response(
        content=raw,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{file_name}"'},
    )


# ── Comunicaciones / Anuncios ────────────────────────────────────────────────

@router.post("/announcements", response_model=schemas.AnnouncementResponse, status_code=201)
def create_announcement(
    payload: schemas.AnnouncementCreate,
    user=Depends(require_roles(["admin", "docente"])),
    db: Session = Depends(get_db),
):
    if user.get("role") == "docente":
        ensure_teacher_assigned_to_course(user, payload.course_id)
    return crud.create_announcement(db, payload, user.get("user_id"))


@router.get("/announcements", response_model=list[schemas.AnnouncementResponse])
def list_announcements(
    course_id: int | None = None,
    user=Depends(require_roles(["admin", "docente", "estudiante"])),
    db: Session = Depends(get_db),
):
    role = user.get("role")

    if role == "docente":
        # Solo sus cursos asignados
        teacher_course_ids = _get_teacher_course_ids(user, db)
        if course_id is not None:
            if course_id not in teacher_course_ids:
                raise HTTPException(status_code=403, detail="Solo puedes ver anuncios de tus cursos")
            return crud.list_announcements(db, course_id=course_id)
        return crud.list_announcements(db, course_ids=teacher_course_ids)

    if role == "estudiante":
        enrolled_course_ids = _get_enrolled_course_ids(user)
        if course_id is not None:
            if course_id not in enrolled_course_ids:
                raise HTTPException(status_code=403, detail="Solo puedes ver anuncios de tus materias")
            return crud.list_announcements(db, course_id=course_id)
        return crud.list_announcements(db, course_ids=enrolled_course_ids)

    # admin: todo
    return crud.list_announcements(db, course_id=course_id)


@router.delete("/announcements/{ann_id}", status_code=204)
def delete_announcement(
    ann_id: int,
    user=Depends(require_roles(["admin", "docente"])),
    db: Session = Depends(get_db),
):
    ann = crud.get_announcement(db, ann_id)
    if not ann:
        raise HTTPException(status_code=404, detail="Anuncio no encontrado")
    if user.get("role") == "docente" and ann.teacher_user_id != user.get("user_id"):
        raise HTTPException(status_code=403, detail="Solo puedes eliminar tus propios anuncios")
    crud.delete_announcement(db, ann)
    return