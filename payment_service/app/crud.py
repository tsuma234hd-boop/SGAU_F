import secrets
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from . import models

WOMPI_TO_LOCAL_STATUS = {
    "PENDING": "pendiente",
    "APPROVED": "aprobado",
    "DECLINED": "rechazado",
    "ERROR": "rechazado",
    "VOIDED": "rechazado",
    "EXPIRED": "expirado",
}


def calculate_account_status(balance: int) -> str:
    if balance <= 0:
        return "al_dia"
    return "pendiente"


def amount_cents_to_pesos(amount_in_cents: int) -> int:
    return amount_in_cents // 100


def build_reference(student_id: int) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    return f"SGAU-{student_id}-{stamp}-{secrets.token_hex(3).upper()}"


def get_or_create_financial_account(db: Session, student_id: int) -> models.FinancialAccount:
    account = (
        db.query(models.FinancialAccount)
        .filter(models.FinancialAccount.student_id == student_id)
        .first()
    )
    if account:
        return account
    account = models.FinancialAccount(
        student_id=student_id,
        total_debt=0,
        total_paid=0,
        balance=0,
        status="sin_deuda",
    )
    db.add(account)
    db.flush()
    return account


def get_financial_account(db: Session, student_id: int) -> models.FinancialAccount | None:
    return (
        db.query(models.FinancialAccount)
        .filter(models.FinancialAccount.student_id == student_id)
        .first()
    )


def add_debt(db: Session, student_id: int, amount: int) -> models.FinancialAccount:
    account = get_or_create_financial_account(db, student_id)
    account.total_debt += amount
    account.balance = account.total_debt - account.total_paid
    account.status = calculate_account_status(account.balance)
    db.commit()
    db.refresh(account)
    return account


def create_payment(
    db: Session,
    *,
    student_id: int,
    amount_in_cents: int,
    currency: str,
    payment_method: str,
    reference: str,
    concept: str | None,
    description: str | None,
    customer_email: str,
    integrity_signature: str,
    expires_at: datetime | None,
    checkout_url: str | None,
    enrollment_id: int | None,
    course_id: int | None,
    academic_order_id: str | None,
    metadata: dict[str, Any],
) -> models.Payment:
    account = get_or_create_financial_account(db, student_id)
    payment = models.Payment(
        student_id=student_id,
        account_id=account.id,
        amount=amount_cents_to_pesos(amount_in_cents),
        amount_in_cents=amount_in_cents,
        currency=currency,
        payment_method=payment_method,
        reference=reference,
        status="pendiente",
        concept=concept,
        description=description,
        customer_email=customer_email,
        integrity_signature=integrity_signature,
        checkout_url=checkout_url,
        expires_at=expires_at,
        enrollment_id=enrollment_id,
        course_id=course_id,
        academic_order_id=academic_order_id,
        metadata_json=metadata,
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return payment


def get_payment(db: Session, payment_id: int) -> models.Payment | None:
    return db.query(models.Payment).filter(models.Payment.id == payment_id).first()


def get_payment_by_reference(db: Session, reference: str) -> models.Payment | None:
    return db.query(models.Payment).filter(models.Payment.reference == reference).first()


def get_payment_by_transaction_id(db: Session, transaction_id: str) -> models.Payment | None:
    return (
        db.query(models.Payment)
        .filter(models.Payment.wompi_transaction_id == transaction_id)
        .first()
    )


def list_payments_by_student(db: Session, student_id: int) -> list[models.Payment]:
    return (
        db.query(models.Payment)
        .filter(models.Payment.student_id == student_id)
        .order_by(models.Payment.created_at.desc())
        .all()
    )


def apply_transaction_status(db: Session, payment: models.Payment, transaction: dict[str, Any]) -> models.Payment:
    wompi_status = str(transaction.get("status") or "")
    next_status = WOMPI_TO_LOCAL_STATUS.get(wompi_status, payment.status)
    old_status = payment.status

    payment.status = next_status
    payment.wompi_status = wompi_status
    payment.wompi_status_message = transaction.get("status_message")
    payment.wompi_transaction_id = transaction.get("id") or payment.wompi_transaction_id
    payment.wompi_raw_response = transaction

    now = datetime.now(timezone.utc)
    if next_status == "aprobado":
        payment.confirmed_at = now
    elif next_status == "rechazado":
        payment.rejected_at = now
    elif next_status == "expirado":
        payment.expired_at = now

    if old_status != "aprobado" and next_status == "aprobado":
        account = get_or_create_financial_account(db, payment.student_id)
        account.total_paid += payment.amount
        account.balance = account.total_debt - account.total_paid
        account.status = calculate_account_status(account.balance)

    db.commit()
    db.refresh(payment)
    return payment


def record_attempt(
    db: Session,
    *,
    payment_id: int,
    action: str,
    endpoint: str,
    success: bool,
    status_code: int | None,
    error_message: str | None,
) -> None:
    attempt = models.PaymentAttempt(
        payment_id=payment_id,
        action=action,
        endpoint=endpoint,
        success=success,
        status_code=status_code,
        error_message=error_message,
    )
    db.add(attempt)
    db.commit()


def save_webhook_event(
    db: Session,
    *,
    event: str,
    checksum: str | None,
    transaction_id: str | None,
    reference: str | None,
    status: str | None,
    environment: str | None,
    payload: dict[str, Any],
    processed: bool,
    error: str | None = None,
) -> models.PaymentWebhookEvent:
    event_row = models.PaymentWebhookEvent(
        event=event,
        checksum=checksum,
        transaction_id=transaction_id,
        reference=reference,
        status=status,
        environment=environment,
        payload=payload,
        processed=processed,
        error=error,
    )
    db.add(event_row)
    db.commit()
    db.refresh(event_row)
    return event_row
