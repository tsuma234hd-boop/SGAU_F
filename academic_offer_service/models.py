from sqlalchemy import Column, Integer, String, ForeignKey, Table, UniqueConstraint, Numeric
from sqlalchemy.orm import relationship
from database import Base

# Tabla intermedia para prerrequisitos
prerequisites_table = Table(
    'prerequisites',
    Base.metadata,
    Column('course_id', ForeignKey('courses.id'), primary_key=True),
    Column('prerequisite_id', ForeignKey('courses.id'), primary_key=True)
)

class Career(Base):
    __tablename__ = "careers"
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, index=True)
    name = Column(String, index=True)
    description = Column(String, nullable=True)
    faculty = Column(String, nullable=True)
    duration_semesters = Column(Integer, nullable=True)
    modality = Column(String, nullable=True)
    degree_title = Column(String, nullable=True)
    credit_cost = Column(Numeric(10, 2), default=145000)  # COP por crédito (130000-160000)

    courses = relationship("Course", back_populates="career")

class Course(Base):
    __tablename__ = "courses"
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, index=True)
    name = Column(String, index=True)
    credits = Column(Integer)
    semester = Column(Integer, nullable=True, index=True)
    schedule = Column(String)
    career_id = Column(Integer, ForeignKey("careers.id"), nullable=True, index=True)
    day_of_week = Column(String, nullable=True)
    start_time = Column(String, nullable=True)
    end_time = Column(String, nullable=True)
    location = Column(String, nullable=True)
    max_students = Column(Integer, nullable=True)  # None = sin límite

    career = relationship("Career", back_populates="courses")
    prerequisites = relationship(
        "Course",
        secondary=prerequisites_table,
        primaryjoin=id==prerequisites_table.c.course_id,
        secondaryjoin=id==prerequisites_table.c.prerequisite_id,
        backref="required_for"
    )
    assignments = relationship("Assignment", back_populates="course")
    sessions = relationship("CourseSession", back_populates="course", cascade="all, delete-orphan")

    @property
    def prerequisite_ids(self):
        return [course.id for course in sorted(self.prerequisites, key=lambda item: item.code or "")]

    @property
    def prerequisite_codes(self):
        return [course.code for course in sorted(self.prerequisites, key=lambda item: item.code or "")]

class Teacher(Base):
    __tablename__ = "teachers"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, unique=True, nullable=True, index=True)
    email = Column(String, unique=True, nullable=True, index=True)
    first_name = Column(String(100), nullable=True)
    last_name = Column(String(100), nullable=True)
    name = Column(String, index=True)
    document_id = Column(String(50), unique=True, nullable=True, index=True)
    career_code = Column(String(50), nullable=True, index=True)

    assignments = relationship("Assignment", back_populates="teacher")

class Assignment(Base):
    __tablename__ = "assignments"
    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"))
    teacher_id = Column(Integer, ForeignKey("teachers.id"))

    course = relationship("Course", back_populates="assignments")
    teacher = relationship("Teacher", back_populates="assignments")
    
    __table_args__ = (
        UniqueConstraint('teacher_id', 'course_id', name='unique_teacher_course'),
    )


class CourseSession(Base):
    __tablename__ = "course_sessions"
    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"))
    day_of_week = Column(String, nullable=False)   # lunes, martes, ...
    start_time = Column(String, nullable=False)    # HH:MM
    end_time = Column(String, nullable=False)      # HH:MM
    classroom = Column(String, nullable=False)
    section = Column(String, nullable=True)
    modality = Column(String, nullable=True)

    course = relationship("Course", back_populates="sessions")