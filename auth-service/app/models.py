from sqlalchemy import Column, Integer, String
from app.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    password = Column(String)
    role = Column(String, default="estudiante")
    first_name = Column(String(100), nullable=True)
    last_name = Column(String(100), nullable=True)
    document_id = Column(String(50), unique=True, nullable=True, index=True)
    