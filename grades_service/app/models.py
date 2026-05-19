from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String, Text, UniqueConstraint
from sqlalchemy.sql import func
from app.db import Base

class Grade(Base):
    __tablename__ = "grades"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer)
    course_id = Column(Integer)
    score = Column(Float)


class Gradebook(Base):
    __tablename__ = "gradebooks"
    __table_args__ = (
        UniqueConstraint("course_id", "period", "section", name="uq_gradebook_course_period_section"),
    )

    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, nullable=False, index=True)
    period = Column(String(20), nullable=False, index=True)
    section = Column(String(20), nullable=False, default="A", index=True)
    teacher_user_id = Column(Integer, nullable=True, index=True)
    status = Column(String(20), nullable=False, default="draft", index=True)
    scale_min = Column(Float, nullable=False, default=0.0)
    scale_max = Column(Float, nullable=False, default=5.0)
    pass_mark = Column(Float, nullable=False, default=3.0)
    rounding_decimals = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class GradeComponent(Base):
    __tablename__ = "grade_components"

    id = Column(Integer, primary_key=True, index=True)
    gradebook_id = Column(Integer, nullable=False, index=True)
    name = Column(String(100), nullable=False)
    weight = Column(Float, nullable=False)
    order_index = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class GradeItem(Base):
    __tablename__ = "grade_items"
    __table_args__ = (
        UniqueConstraint(
            "gradebook_id",
            "component_id",
            "student_id",
            name="uq_grade_item_gradebook_component_student",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    gradebook_id = Column(Integer, nullable=False, index=True)
    component_id = Column(Integer, nullable=False, index=True)
    student_id = Column(Integer, nullable=False, index=True)
    score = Column(Float, nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class FinalGrade(Base):
    __tablename__ = "final_grades"
    __table_args__ = (
        UniqueConstraint("gradebook_id", "student_id", name="uq_final_grade_gradebook_student"),
    )

    id = Column(Integer, primary_key=True, index=True)
    gradebook_id = Column(Integer, nullable=False, index=True)
    student_id = Column(Integer, nullable=False, index=True)
    auto_score = Column(Float, nullable=False, default=0.0)
    manual_score = Column(Float, nullable=True)
    final_score = Column(Float, nullable=False, default=0.0)
    is_manual_override = Column(Boolean, nullable=False, default=False)
    override_reason = Column(String(255), nullable=True)
    status = Column(String(20), nullable=False, default="draft", index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class GradeAudit(Base):
    __tablename__ = "grade_audits"

    id = Column(Integer, primary_key=True, index=True)
    gradebook_id = Column(Integer, nullable=False, index=True)
    # Puede referir a un final_grade (override) o ser null (cambio de estado)
    final_grade_id = Column(Integer, nullable=True, index=True)
    student_id = Column(Integer, nullable=True, index=True)
    action = Column(String(50), nullable=False)          # "override" | "status_change"
    old_value = Column(String(100), nullable=True)
    new_value = Column(String(100), nullable=True)
    actor_user_id = Column(Integer, nullable=True)
    reason = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ActivityBox(Base):
    __tablename__ = "activity_boxes"

    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, nullable=False, index=True)
    teacher_user_id = Column(Integer, nullable=False, index=True)
    title = Column(String(200), nullable=False)
    weight = Column(Float, nullable=False, default=0.0)  # % sobre 100; 0 = no cuenta
    due_date = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ActivitySubmission(Base):
    __tablename__ = "activity_submissions"
    __table_args__ = (
        UniqueConstraint("box_id", "student_id", name="uq_activity_submission_box_student"),
    )

    id = Column(Integer, primary_key=True, index=True)
    box_id = Column(Integer, nullable=False, index=True)
    student_id = Column(Integer, nullable=False, index=True)
    student_comment = Column(String(500), nullable=True)
    file_name = Column(String(255), nullable=True)
    file_content = Column(Text, nullable=True)
    submitted_at = Column(DateTime(timezone=True), server_default=func.now())
    score = Column(Float, nullable=True)
    teacher_comment = Column(String(500), nullable=True)
    graded_at = Column(DateTime(timezone=True), nullable=True)


class Announcement(Base):
    __tablename__ = "announcements"

    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, nullable=False, index=True)
    teacher_user_id = Column(Integer, nullable=False, index=True)
    title = Column(String(200), nullable=False)
    body = Column(Text, nullable=False)
    pinned = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())