from sqlalchemy.orm import Session
from app import models
from datetime import datetime, timezone

def create_grade(db: Session, grade):
    db_grade = models.Grade(**grade.model_dump())
    db.add(db_grade)
    db.commit()
    db.refresh(db_grade)
    return db_grade

def get_grade(db: Session, grade_id: int):
    return db.query(models.Grade).filter(models.Grade.id == grade_id).first()

def update_grade(db: Session, grade_id: int, new_score: float):
    grade = db.query(models.Grade).filter(models.Grade.id == grade_id).first()
    if not grade:
        return None
    grade.score = new_score
    db.commit()
    db.refresh(grade)
    return grade

def get_grades_by_student(db: Session, student_id: int):
    return db.query(models.Grade).filter(models.Grade.student_id == student_id).all()

def get_grades_by_course(db: Session, course_id: int):
    return db.query(models.Grade).filter(models.Grade.course_id == course_id).all()


def create_gradebook(db: Session, payload, teacher_user_id: int | None = None):
    gradebook = models.Gradebook(
        course_id=payload.course_id,
        period=payload.period,
        section=payload.section,
        teacher_user_id=teacher_user_id,
    )
    db.add(gradebook)
    db.commit()
    db.refresh(gradebook)
    return gradebook


def get_gradebook(db: Session, gradebook_id: int):
    return db.query(models.Gradebook).filter(models.Gradebook.id == gradebook_id).first()


def list_gradebooks(
    db: Session,
    period: str | None = None,
    course_id: int | None = None,
    section: str | None = None,
    status: str | None = None,
    teacher_user_id: int | None = None,
):
    query = db.query(models.Gradebook)
    if period:
        query = query.filter(models.Gradebook.period == period)
    if course_id:
        query = query.filter(models.Gradebook.course_id == course_id)
    if section:
        query = query.filter(models.Gradebook.section == section)
    if status:
        query = query.filter(models.Gradebook.status == status)
    if teacher_user_id is not None:
        query = query.filter(models.Gradebook.teacher_user_id == teacher_user_id)
    return query.order_by(models.Gradebook.id.desc()).all()


def set_gradebook_status(db: Session, gradebook, new_status: str):
    gradebook.status = new_status
    db.commit()
    db.refresh(gradebook)
    return gradebook


def list_components(db: Session, gradebook_id: int):
    return (
        db.query(models.GradeComponent)
        .filter(
            models.GradeComponent.gradebook_id == gradebook_id,
            models.GradeComponent.is_active.is_(True),
        )
        .order_by(models.GradeComponent.order_index.asc(), models.GradeComponent.id.asc())
        .all()
    )


def get_component(db: Session, component_id: int):
    return (
        db.query(models.GradeComponent)
        .filter(models.GradeComponent.id == component_id, models.GradeComponent.is_active.is_(True))
        .first()
    )


def create_component(db: Session, gradebook_id: int, payload):
    component = models.GradeComponent(
        gradebook_id=gradebook_id,
        name=payload.name,
        weight=payload.weight,
        order_index=payload.order_index,
    )
    db.add(component)
    db.commit()
    db.refresh(component)
    return component


def get_components_total_weight(db: Session, gradebook_id: int):
    components = list_components(db, gradebook_id)
    return sum(c.weight for c in components)


def upsert_grade_items(db: Session, gradebook_id: int, component_id: int, items):
    upserted = []
    for item in items:
        existing = (
            db.query(models.GradeItem)
            .filter(
                models.GradeItem.gradebook_id == gradebook_id,
                models.GradeItem.component_id == component_id,
                models.GradeItem.student_id == item.student_id,
            )
            .first()
        )
        if existing:
            existing.score = item.score
            upserted.append(existing)
            continue

        grade_item = models.GradeItem(
            gradebook_id=gradebook_id,
            component_id=component_id,
            student_id=item.student_id,
            score=item.score,
        )
        db.add(grade_item)
        upserted.append(grade_item)

    db.commit()
    return upserted


def get_grade_items_by_gradebook(db: Session, gradebook_id: int):
    return db.query(models.GradeItem).filter(models.GradeItem.gradebook_id == gradebook_id).all()


def recalculate_final_grades(db: Session, gradebook):
    components = list_components(db, gradebook.id)
    component_map = {c.id: c for c in components}
    items = get_grade_items_by_gradebook(db, gradebook.id)

    by_student: dict[int, list[models.GradeItem]] = {}
    for item in items:
        by_student.setdefault(item.student_id, []).append(item)

    recalculated = []
    for student_id, student_items in by_student.items():
        weighted_sum = 0.0
        for item in student_items:
            component = component_map.get(item.component_id)
            if not component:
                continue
            weighted_sum += item.score * (component.weight / 100.0)

        auto_score = round(weighted_sum, gradebook.rounding_decimals)

        final_grade = (
            db.query(models.FinalGrade)
            .filter(
                models.FinalGrade.gradebook_id == gradebook.id,
                models.FinalGrade.student_id == student_id,
            )
            .first()
        )

        if not final_grade:
            final_grade = models.FinalGrade(
                gradebook_id=gradebook.id,
                student_id=student_id,
                auto_score=auto_score,
                final_score=auto_score,
                status=gradebook.status,
            )
            db.add(final_grade)
        else:
            final_grade.auto_score = auto_score
            final_grade.status = gradebook.status
            if not final_grade.is_manual_override:
                final_grade.final_score = auto_score

        recalculated.append(final_grade)

    db.commit()
    return recalculated


def list_final_grades(db: Session, gradebook_id: int):
    return (
        db.query(models.FinalGrade)
        .filter(models.FinalGrade.gradebook_id == gradebook_id)
        .order_by(models.FinalGrade.student_id.asc())
        .all()
    )


def get_final_grade(db: Session, final_grade_id: int):
    return db.query(models.FinalGrade).filter(models.FinalGrade.id == final_grade_id).first()


def override_final_grade(db: Session, final_grade, manual_score: float, reason: str):
    final_grade.manual_score = manual_score
    final_grade.final_score = manual_score
    final_grade.is_manual_override = True
    final_grade.override_reason = reason
    db.commit()
    db.refresh(final_grade)
    return final_grade


# ── Auditoría ──────────────────────────────────────────────────────────────

def create_audit_entry(
    db: Session,
    gradebook_id: int,
    action: str,
    actor_user_id: int | None = None,
    final_grade_id: int | None = None,
    student_id: int | None = None,
    old_value: str | None = None,
    new_value: str | None = None,
    reason: str | None = None,
):
    entry = models.GradeAudit(
        gradebook_id=gradebook_id,
        action=action,
        actor_user_id=actor_user_id,
        final_grade_id=final_grade_id,
        student_id=student_id,
        old_value=old_value,
        new_value=new_value,
        reason=reason,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


def list_audit(db: Session, gradebook_id: int):
    return (
        db.query(models.GradeAudit)
        .filter(models.GradeAudit.gradebook_id == gradebook_id)
        .order_by(models.GradeAudit.created_at.desc())
        .all()
    )


def create_activity_box(db: Session, payload, teacher_user_id: int):
    box = models.ActivityBox(
        course_id=payload.course_id,
        teacher_user_id=teacher_user_id,
        title=payload.title,
        weight=payload.weight,
        due_date=payload.due_date,
    )
    db.add(box)
    db.commit()
    db.refresh(box)
    return box


def list_activity_boxes(
    db: Session,
    course_id: int | None = None,
    teacher_user_id: int | None = None,
    course_ids: list[int] | None = None,
):
    query = db.query(models.ActivityBox)
    if course_id is not None:
        query = query.filter(models.ActivityBox.course_id == course_id)
    if teacher_user_id is not None:
        query = query.filter(models.ActivityBox.teacher_user_id == teacher_user_id)
    if course_ids is not None:
        if not course_ids:
            return []
        query = query.filter(models.ActivityBox.course_id.in_(course_ids))
    return query.order_by(models.ActivityBox.due_date.asc(), models.ActivityBox.id.desc()).all()


def get_activity_box(db: Session, box_id: int):
    return db.query(models.ActivityBox).filter(models.ActivityBox.id == box_id).first()


def delete_activity_box(db: Session, box):
    db.query(models.ActivitySubmission).filter(models.ActivitySubmission.box_id == box.id).delete()
    db.delete(box)
    db.commit()


def upsert_activity_submission(
    db: Session,
    box_id: int,
    student_id: int,
    student_comment: str | None = None,
    file_name: str | None = None,
    file_content: str | None = None,
):
    sub = (
        db.query(models.ActivitySubmission)
        .filter(
            models.ActivitySubmission.box_id == box_id,
            models.ActivitySubmission.student_id == student_id,
        )
        .first()
    )
    if not sub:
        sub = models.ActivitySubmission(
            box_id=box_id,
            student_id=student_id,
            student_comment=student_comment,
            file_name=file_name,
            file_content=file_content,
        )
        db.add(sub)
    else:
        sub.student_comment = student_comment
        if file_name:
            sub.file_name = file_name
            sub.file_content = file_content
        sub.submitted_at = datetime.now(timezone.utc)
        sub.score = None
        sub.teacher_comment = None
        sub.graded_at = None

    db.commit()
    db.refresh(sub)
    return sub


def list_activity_submissions(db: Session, box_id: int):
    return (
        db.query(models.ActivitySubmission)
        .filter(models.ActivitySubmission.box_id == box_id)
        .order_by(models.ActivitySubmission.submitted_at.desc())
        .all()
    )


def get_activity_submission(db: Session, submission_id: int):
    return db.query(models.ActivitySubmission).filter(models.ActivitySubmission.id == submission_id).first()


def get_my_activity_submission(db: Session, box_id: int, student_id: int):
    return (
        db.query(models.ActivitySubmission)
        .filter(
            models.ActivitySubmission.box_id == box_id,
            models.ActivitySubmission.student_id == student_id,
        )
        .first()
    )


def grade_activity_submission(db: Session, submission, score: float, teacher_comment: str | None = None):
    submission.score = score
    submission.teacher_comment = teacher_comment
    submission.graded_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(submission)
    return submission


def get_course_definitivas(db: Session, course_id: int):
    """
    Calcula la nota definitiva de cada estudiante en un curso usando pesos de los buzones.
    Solo cuentan los buzones con weight > 0 que además tengan la entrega calificada.
    Devuelve lista de dicts con student_id, detalle por buzón y nota_final.
    """
    boxes = (
        db.query(models.ActivityBox)
        .filter(
            models.ActivityBox.course_id == course_id,
            models.ActivityBox.weight > 0,
        )
        .order_by(models.ActivityBox.id.asc())
        .all()
    )
    if not boxes:
        return {"boxes": [], "students": [], "total_weight": 0.0}

    total_weight = round(sum(b.weight for b in boxes), 1)
    box_ids = [b.id for b in boxes]

    submissions = (
        db.query(models.ActivitySubmission)
        .filter(
            models.ActivitySubmission.box_id.in_(box_ids),
            models.ActivitySubmission.score.isnot(None),
        )
        .all()
    )

    # Agrupar entregas por estudiante
    by_student: dict[int, dict[int, float]] = {}
    for s in submissions:
        by_student.setdefault(s.student_id, {})[s.box_id] = s.score

    students_out = []
    for student_id, scores_map in by_student.items():
        detail = []
        weighted_sum = 0.0
        covered_weight = 0.0
        for b in boxes:
            nota = scores_map.get(b.id)
            detail.append({
                "box_id": b.id,
                "title": b.title,
                "weight": b.weight,
                "score": nota,
            })
            if nota is not None:
                weighted_sum += nota * (b.weight / 100.0)
                covered_weight += b.weight

        # Definitiva = suma ponderada / (peso cubierto / 100)
        # Si no están todos los buzones calificados, la definitiva es parcial
        if covered_weight > 0:
            nota_final = round(weighted_sum / (covered_weight / 100.0), 1)
        else:
            nota_final = None

        students_out.append({
            "student_id": student_id,
            "detail": detail,
            "covered_weight": round(covered_weight, 1),
            "nota_final": nota_final,
            "completo": round(covered_weight, 1) == round(total_weight, 1),
        })

    students_out.sort(key=lambda x: x["student_id"])

    return {
        "course_id": course_id,
        "boxes": [{"id": b.id, "title": b.title, "weight": b.weight} for b in boxes],
        "total_weight": total_weight,
        "students": students_out,
    }


# ── Comunicaciones ──────────────────────────────────────────────────────────

def create_announcement(db: Session, payload, teacher_user_id: int):
    ann = models.Announcement(
        course_id=payload.course_id,
        teacher_user_id=teacher_user_id,
        title=payload.title,
        body=payload.body,
        pinned=payload.pinned,
    )
    db.add(ann)
    db.commit()
    db.refresh(ann)
    return ann


def list_announcements(db: Session, course_id: int | None = None, course_ids: list[int] | None = None):
    q = db.query(models.Announcement)
    if course_id is not None:
        q = q.filter(models.Announcement.course_id == course_id)
    if course_ids is not None:
        if not course_ids:
            return []
        q = q.filter(models.Announcement.course_id.in_(course_ids))
    return q.order_by(
        models.Announcement.pinned.desc(),
        models.Announcement.created_at.desc(),
    ).all()


def get_announcement(db: Session, ann_id: int):
    return db.query(models.Announcement).filter(models.Announcement.id == ann_id).first()


def delete_announcement(db: Session, ann: models.Announcement):
    db.delete(ann)
    db.commit()