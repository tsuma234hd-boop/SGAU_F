from pydantic import BaseModel, Field, ConfigDict, field_validator
from typing import List, Optional

class CareerBase(BaseModel):
    code: str
    name: str
    description: str | None = None
    faculty: str | None = None
    duration_semesters: int | None = None
    modality: str | None = None
    degree_title: str | None = None
    credit_cost: float | None = None

class CareerCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    code: str = Field(..., alias='code')
    name: str = Field(..., alias='name')
    description: str | None = Field(None, alias='description')
    faculty: str | None = Field(None, alias='faculty')
    duration_semesters: int | None = Field(None, alias='duration_semesters')
    modality: str | None = Field(None, alias='modality')
    degree_title: str | None = Field(None, alias='degree_title')

class Career(CareerBase):
    id: int
    model_config = ConfigDict(from_attributes=True)

class CourseBase(BaseModel):
    code: str
    name: str
    credits: int
    semester: int | None = None
    schedule: str | None = None
    career_id: int | None = None
    day_of_week: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    location: str | None = None
    max_students: int | None = None

class CourseCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    code: str = Field(..., alias='codigo')
    name: str = Field(..., alias='nombre')
    credits: int = Field(..., alias='creditos')
    semester: int | None = Field(None, alias='semestre')
    career_id: int = Field(..., alias='career_id')
    day_of_week: str = Field(..., alias='dia')
    start_time: str = Field(..., alias='hora_inicio')
    end_time: str = Field(..., alias='hora_fin')
    location: str = Field(..., alias='aula')
    schedule: str | None = Field(None, alias='horario')
    prerequisites: Optional[List[int]] = []
    max_students: int | None = Field(None, alias='max_estudiantes')

class Course(CourseBase):
    id: int
    prerequisite_ids: List[int] = []
    prerequisite_codes: List[str] = []
    model_config = ConfigDict(from_attributes=True)

class CourseUpdate(BaseModel):
    code: str | None = None
    name: str | None = None
    credits: int | None = None
    semester: int | None = None
    schedule: str | None = None
    career_id: int | None = None
    day_of_week: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    location: str | None = None
    prerequisites: Optional[List[int]] = None
    max_students: int | None = None

class TeacherBase(BaseModel):
    user_id: int | None = None
    email: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    name: str | None = None
    document_id: str | None = None
    career_code: str | None = None
    career_codes: list[str] = Field(default_factory=list)

class TeacherCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    user_id: int | None = Field(None, alias='user_id')
    email: str | None = Field(None, alias='email')
    first_name: str | None = Field(None, alias='nombres')
    last_name: str | None = Field(None, alias='apellidos')
    name: str | None = Field(None, alias='nombre')
    document_id: str | None = Field(None, alias='document_id')
    career_code: str | None = Field(None, alias='career_code')
    
    @field_validator('document_id')
    @classmethod
    def validate_document_id(cls, v):
        if v is not None:
            if not v.isdigit():
                raise ValueError('Cédula debe contener solo dígitos')
            if len(v) != 10:
                raise ValueError('Cédula debe tener exactamente 10 dígitos')
        return v


class TeacherUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    email: str | None = Field(None, alias='email')
    first_name: str | None = Field(None, alias='nombres')
    last_name: str | None = Field(None, alias='apellidos')
    name: str | None = Field(None, alias='nombre')
    career_code: str | None = Field(None, alias='career_code')
    document_id: str | None = None
    
    @field_validator('document_id')
    @classmethod
    def validate_document_id_update(cls, v):
        if v is not None:
            if not v.isdigit():
                raise ValueError('Cédula debe contener solo dígitos')
            if len(v) != 10:
                raise ValueError('Cédula debe tener exactamente 10 dígitos')
        return v
    document_id: str | None = Field(None, alias='document_id')

class Teacher(TeacherBase):
    id: int
    model_config = ConfigDict(from_attributes=True)

class AssignmentCreate(BaseModel):
    course_id: int
    teacher_id: int


class AssignmentUpdate(BaseModel):
    course_id: int
    teacher_id: int

class Assignment(AssignmentCreate):
    id: int
    model_config = ConfigDict(from_attributes=True)


class CourseSessionCreate(BaseModel):
    course_id: int
    teacher_id: int | None = None
    day_of_week: str
    start_time: str
    end_time: str
    classroom: str
    section: str | None = None
    modality: str | None = None

class CourseSession(CourseSessionCreate):
    id: int
    course_code: str | None = None
    course_name: str | None = None
    career_id: int | None = None
    teacher_name: str | None = None
    model_config = ConfigDict(from_attributes=True)