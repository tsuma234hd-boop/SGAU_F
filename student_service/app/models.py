from sqlalchemy import Column, Integer, String, Float
from .db import Base

class Student(Base):
    __tablename__ = "students"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, unique=True, nullable=False)
    nombre = Column(String(100), nullable=False)
    apellido = Column(String(100), nullable=False)
    email = Column(String(150), unique=True, nullable=False, index=True)
    document_id = Column(String(50), unique=True, nullable=True, index=True)
    program = Column(String(100), nullable=True)
    status = Column(String(50), default="activo")
    average = Column(Float, default=0.0)