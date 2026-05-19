from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


PaymentStatus = Literal["pendiente", "aprobado", "rechazado", "expirado"]
PaymentMethod = Literal["checkout", "card", "pse", "nequi"]


class FinancialAccountBase(BaseModel):
    student_id: int
    total_debt: int = 0
    total_paid: int = 0
    balance: int = 0
    status: str = "sin_deuda"


class FinancialAccountCreate(BaseModel):
    student_id: int


class FinancialAccountResponse(FinancialAccountBase):
    id: int
    model_config = ConfigDict(from_attributes=True)


class DebtUpdate(BaseModel):
    amount: int = Field(gt=0)


class DirectPaymentData(BaseModel):
    payment_source_id: int = Field(gt=0)
    installments: int = Field(default=1, ge=1, le=36)


class PaymentCreateRequest(BaseModel):
    student_id: int
    amount_in_cents: int = Field(gt=0)
    customer_email: EmailStr
    concept: str = "Pago academico SGAU"
    description: str | None = None
    payment_method: PaymentMethod = "checkout"
    reference: str | None = Field(default=None, max_length=100)
    enrollment_id: int | None = None
    course_id: int | None = None
    academic_order_id: str | None = Field(default=None, max_length=100)
    expires_at: datetime | None = None
    redirect_url: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    single_use_link: bool = True
    direct_payment: DirectPaymentData | None = None

    @field_validator("expires_at")
    @classmethod
    def validate_expiration(cls, value: datetime | None) -> datetime | None:
        if value and value <= datetime.now(timezone.utc) + timedelta(minutes=1):
            raise ValueError("expires_at debe ser una fecha futura")
        return value


class PaymentResponse(BaseModel):
    id: int
    student_id: int
    account_id: int
    enrollment_id: int | None = None
    course_id: int | None = None
    academic_order_id: str | None = None
    amount: int
    amount_in_cents: int
    currency: str
    payment_method: str
    reference: str
    status: str
    concept: str | None = None
    description: str | None = None
    customer_email: str | None = None
    provider: str
    wompi_transaction_id: str | None = None
    wompi_payment_link_id: str | None = None
    checkout_url: str | None = None
    integrity_signature: str | None = None
    wompi_status: str | None = None
    wompi_status_message: str | None = None
    expires_at: datetime | None = None
    confirmed_at: datetime | None = None
    rejected_at: datetime | None = None
    expired_at: datetime | None = None
    created_at: datetime
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class PaymentCreateResponse(BaseModel):
    payment: PaymentResponse
    checkout_url: str | None = None
    wompi_link_id: str | None = None
    wompi_transaction_id: str | None = None


class PaymentStatusResponse(BaseModel):
    reference: str
    status: str
    wompi_status: str | None = None
    wompi_transaction_id: str | None = None
    checkout_url: str | None = None


class WebhookAck(BaseModel):
    received: bool
    processed: bool
    payment_reference: str | None = None


class RefundRequest(BaseModel):
    payment_id: int | None = None
    reference: str | None = None
    amount_in_cents: int | None = Field(default=None, gt=0)
    reason: str = Field(default="Solicitud de reembolso", max_length=255)


class RefundResponse(BaseModel):
    reference: str
    status: str
    refund_status: str | None = None
    wompi_response: dict[str, Any]
