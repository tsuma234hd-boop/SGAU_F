from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class EnrollmentBase(BaseModel):
    student_id: int
    course_id: int
    status: Optional[str] = "pendiente"

class EnrollmentCreate(EnrollmentBase):
    pass

class EnrollmentUpdate(BaseModel):
    status: Optional[str] = None

class EnrollmentResponse(EnrollmentBase):
    id: int
    enrollment_date: datetime

    class Config:
        orm_mode = True
