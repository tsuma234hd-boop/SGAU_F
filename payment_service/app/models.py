from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from .db import Base


class FinancialAccount(Base):
    __tablename__ = "financial_accounts"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, unique=True, nullable=False, index=True)
    total_debt = Column(Integer, default=0)
    total_paid = Column(Integer, default=0)
    balance = Column(Integer, default=0)
    status = Column(String(50), default="sin_deuda")


class Payment(Base):
    __tablename__ = "payments"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, nullable=False, index=True)
    account_id = Column(Integer, ForeignKey("financial_accounts.id"), nullable=False)

    enrollment_id = Column(Integer, nullable=True, index=True)
    course_id = Column(Integer, nullable=True, index=True)
    academic_order_id = Column(String(100), nullable=True, index=True)

    amount = Column(Integer, nullable=False)
    amount_in_cents = Column(Integer, nullable=False)
    currency = Column(String(3), default="COP", nullable=False)
    payment_method = Column(String(50), nullable=False)
    payment_method_type = Column(String(50), nullable=True)
    reference = Column(String(100), unique=True, nullable=False, index=True)
    status = Column(String(50), default="pendiente", index=True)
    concept = Column(String(100), nullable=True)
    description = Column(String(255), nullable=True)
    customer_email = Column(String(255), nullable=True)

    provider = Column(String(50), default="wompi", nullable=False)
    wompi_transaction_id = Column(String(120), nullable=True, unique=True, index=True)
    wompi_payment_link_id = Column(String(120), nullable=True, index=True)
    checkout_url = Column(Text, nullable=True)
    redirect_url = Column(Text, nullable=True)
    integrity_signature = Column(String(128), nullable=True)
    wompi_status = Column(String(50), nullable=True)
    wompi_status_message = Column(String(255), nullable=True)
    wompi_raw_response = Column(JSONB, nullable=True)
    metadata_json = Column(JSONB, nullable=True)
    webhook_verified = Column(Boolean, default=False)

    refund_status = Column(String(50), nullable=True)
    refund_id = Column(String(120), nullable=True)
    refund_reason = Column(String(255), nullable=True)

    expires_at = Column(DateTime(timezone=True), nullable=True)
    confirmed_at = Column(DateTime(timezone=True), nullable=True)
    rejected_at = Column(DateTime(timezone=True), nullable=True)
    expired_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class PaymentSession(Base):
    """Sesion local conservada para compatibilidad con el flujo simulado anterior."""

    __tablename__ = "payment_sessions"

    id = Column(Integer, primary_key=True, index=True)
    session_token = Column(String(64), unique=True, nullable=False, index=True)
    student_id = Column(Integer, nullable=False, index=True)
    amount = Column(Integer, nullable=False)
    concept = Column(String(100), nullable=True)
    method = Column(String(50), nullable=False)
    bank_code = Column(String(20), nullable=True)
    phone = Column(String(20), nullable=True)
    status = Column(String(30), default="pending")
    redirect_url = Column(String(255), nullable=True)
    payment_id = Column(Integer, ForeignKey("payments.id"), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    confirmed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class PaymentWebhookEvent(Base):
    __tablename__ = "payment_webhook_events"

    id = Column(Integer, primary_key=True, index=True)
    event = Column(String(120), nullable=False, index=True)
    checksum = Column(String(128), nullable=True, index=True)
    transaction_id = Column(String(120), nullable=True, index=True)
    reference = Column(String(100), nullable=True, index=True)
    status = Column(String(50), nullable=True)
    environment = Column(String(20), nullable=True)
    payload = Column(JSONB, nullable=False)
    processed = Column(Boolean, default=False)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class PaymentAttempt(Base):
    __tablename__ = "payment_attempts"

    id = Column(Integer, primary_key=True, index=True)
    payment_id = Column(Integer, ForeignKey("payments.id"), nullable=False, index=True)
    action = Column(String(50), nullable=False)
    endpoint = Column(String(120), nullable=False)
    success = Column(Boolean, default=False)
    status_code = Column(Integer, nullable=True)
    error_message = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
