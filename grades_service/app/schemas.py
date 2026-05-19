from pydantic import BaseModel, field_validator
from datetime import datetime

class GradeCreate(BaseModel):
    student_id: int
    course_id: int
    score: float

    @field_validator('score')
    @classmethod
    def score_range(cls, v):
        if not (0.0 <= v <= 5.0):
            raise ValueError('La nota debe estar entre 0.0 y 5.0')
        return v

class GradeUpdate(BaseModel):
    score: float

    @field_validator('score')
    @classmethod
    def score_range(cls, v):
        if not (0.0 <= v <= 5.0):
            raise ValueError('La nota debe estar entre 0.0 y 5.0')
        return v

class GradeResponse(GradeCreate):
    id: int

    class Config:
        from_attributes = True


class GradebookCreate(BaseModel):
    course_id: int
    period: str
    section: str = "A"


class GradebookStatusUpdate(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def status_allowed(cls, v):
        if v not in {"draft", "published", "closed"}:
            raise ValueError("Estado inválido")
        return v


class GradebookResponse(BaseModel):
    id: int
    course_id: int
    period: str
    section: str
    teacher_user_id: int | None = None
    status: str
    scale_min: float
    scale_max: float
    pass_mark: float
    rounding_decimals: int

    class Config:
        from_attributes = True


class GradeComponentCreate(BaseModel):
    name: str
    weight: float
    order_index: int = 0

    @field_validator("weight")
    @classmethod
    def weight_range(cls, v):
        if not (0 < v <= 100):
            raise ValueError("El peso debe estar entre 0 y 100")
        return v


class GradeComponentResponse(BaseModel):
    id: int
    gradebook_id: int
    name: str
    weight: float
    order_index: int
    is_active: bool

    class Config:
        from_attributes = True


class GradeItemInput(BaseModel):
    student_id: int
    score: float

    @field_validator("score")
    @classmethod
    def score_range(cls, v):
        if not (0.0 <= v <= 5.0):
            raise ValueError("La nota debe estar entre 0.0 y 5.0")
        return v


class GradeItemsBulkUpsert(BaseModel):
    component_id: int
    items: list[GradeItemInput]


class GradeItemResponse(BaseModel):
    id: int
    gradebook_id: int
    component_id: int
    student_id: int
    score: float

    class Config:
        from_attributes = True


class FinalGradeOverride(BaseModel):
    manual_score: float
    reason: str

    @field_validator("manual_score")
    @classmethod
    def manual_score_range(cls, v):
        if not (0.0 <= v <= 5.0):
            raise ValueError("La nota manual debe estar entre 0.0 y 5.0")
        return v


class FinalGradeResponse(BaseModel):
    id: int
    gradebook_id: int
    student_id: int
    auto_score: float
    manual_score: float | None = None
    final_score: float
    is_manual_override: bool
    override_reason: str | None = None
    status: str
    passed: bool

    class Config:
        from_attributes = True


class GradeAuditResponse(BaseModel):
    id: int
    gradebook_id: int
    final_grade_id: int | None = None
    student_id: int | None = None
    action: str
    old_value: str | None = None
    new_value: str | None = None
    actor_user_id: int | None = None
    reason: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class ActivityBoxCreate(BaseModel):
    course_id: int
    title: str
    weight: float = 0.0  # % sobre 100
    due_date: datetime | None = None

    @field_validator("weight")
    @classmethod
    def weight_range(cls, v):
        if not (0.0 <= v <= 100.0):
            raise ValueError("El peso debe estar entre 0 y 100")
        return round(v, 1)


class ActivityBoxResponse(BaseModel):
    id: int
    course_id: int
    teacher_user_id: int
    title: str
    weight: float
    due_date: datetime | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class ActivitySubmissionResponse(BaseModel):
    id: int
    box_id: int
    student_id: int
    student_comment: str | None = None
    file_name: str | None = None
    submitted_at: datetime
    score: float | None = None
    teacher_comment: str | None = None
    graded_at: datetime | None = None

    class Config:
        from_attributes = True


class ActivitySubmissionGrade(BaseModel):
    score: float
    teacher_comment: str | None = None

    @field_validator("score")
    @classmethod
    def score_range(cls, v):
        if not (0.0 <= v <= 5.0):
            raise ValueError("La nota debe estar entre 0.0 y 5.0")
        return round(v, 1)


# ── Comunicaciones ──────────────────────────────────────────────────────────

class AnnouncementCreate(BaseModel):
    course_id: int
    title: str
    body: str
    pinned: bool = False


class AnnouncementResponse(BaseModel):
    id: int
    course_id: int
    teacher_user_id: int
    title: str
    body: str
    pinned: bool
    created_at: datetime

    class Config:
        from_attributes = True