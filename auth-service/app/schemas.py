from pydantic import BaseModel, field_validator, model_validator

class UserCreate(BaseModel):
    email: str
    password: str
    role: str = "estudiante"

    first_name: str | None = None
    last_name: str | None = None
    document_id: str | None = None

    @field_validator('document_id')
    @classmethod
    def validate_document_id(cls, v):
        if v is not None:
            if not v.isdigit():
                raise ValueError('Cédula debe contener solo dígitos')
            if len(v) != 10:
                raise ValueError('Cédula debe tener exactamente 10 dígitos')
        return v

    @model_validator(mode='after')
    def validate_email_by_role(self):
        if not self.email.endswith('@ucc.edu.co'):
            raise ValueError('El correo debe ser de la universidad (@ucc.edu.co)')

        if self.role == 'docente':
            if not (self.first_name and self.last_name and self.document_id):
                raise ValueError('Docente debe incluir nombre, apellido y cédula')
        elif self.role == 'estudiante':
            if not (self.first_name and self.last_name and self.document_id):
                raise ValueError('Estudiante debe incluir nombres, apellidos y número de identidad')

        return self

class UserLogin(BaseModel):
    email: str
    password: str


class UserSelfUpdate(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    current_password: str | None = None
    new_password: str | None = None

    @model_validator(mode='after')
    def validate_password_change(self):
        if self.new_password is not None:
            if not self.current_password:
                raise ValueError('Debes enviar la contraseña actual para cambiarla')
            if len(self.new_password) < 8:
                raise ValueError('La nueva contraseña debe tener al menos 8 caracteres')
        return self