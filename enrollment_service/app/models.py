from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.sql import func
from .database import Base

class Enrollment(Base):
    __tablename__ = "enrollments"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, nullable=False)
    course_id = Column(Integer, nullable=False)
    section_id = Column(Integer, nullable=True)
    status = Column(String(50), default="pendiente")
    enrollment_date = Column(DateTime(timezone=True), server_default=func.now())
