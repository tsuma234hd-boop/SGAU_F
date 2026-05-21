from pydantic import BaseModel, ConfigDict
from datetime import datetime
from typing import Optional

class EnrollmentBase(BaseModel):
    student_id: int
    course_id: int
    section_id: Optional[int] = None
    status: Optional[str] = "pendiente"

class EnrollmentCreate(EnrollmentBase):
    pass

class EnrollmentUpdate(BaseModel):
    status: Optional[str] = None

class EnrollmentResponse(EnrollmentBase):
    id: int
    enrollment_date: datetime
    model_config = ConfigDict(from_attributes=True)
