from pydantic import BaseModel, Field, field_validator

class StudentBase(BaseModel):
    nombre: str = Field(..., min_length=2, max_length=100)
    apellido: str = Field(..., min_length=2, max_length=100)
    email: str
    document_id: str | None = None
    program: str | None = None
    status: str = "activo"

class StudentCreate(StudentBase):
    user_id: int
    nombre: str = Field(..., min_length=2, max_length=100)
    apellido: str = Field(..., min_length=2, max_length=100)
    email: str
    document_id: str | None = None
    program: str | None = None
    status: str = "activo"
    
    @field_validator('document_id')
    @classmethod
    def validate_document_id(cls, v):
        if v is not None:
            if not v.isdigit():
                raise ValueError('Cédula debe contener solo dígitos')
            if len(v) != 10:
                raise ValueError('Cédula debe tener exactamente 10 dígitos')
        return v

class StudentUpdate(BaseModel):
    nombre: str | None = Field(None, min_length=2, max_length=100)
    apellido: str | None = Field(None, min_length=2, max_length=100)
    email: str | None = None
    document_id: str | None = None
    program: str | None = None
    status: str | None = None
    
    @field_validator('document_id')
    @classmethod
    def validate_document_id_update(cls, v):
        if v is not None:
            if not v.isdigit():
                raise ValueError('Cédula debe contener solo dígitos')
            if len(v) != 10:
                raise ValueError('Cédula debe tener exactamente 10 dígitos')
        return v
    status: str | None = None

class StudentResponse(StudentBase):
    id: int
    user_id: int
    average: float = 0.0

    class Config:
        from_attributes = True