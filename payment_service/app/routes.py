import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from . import crud, models, schemas
from .auth import require_roles, resolve_student_id
from .core.config import get_settings
from .core.security import build_integrity_signature
from .db import get_db
from .services.payment_orchestrator import (
    create_payment,
    process_webhook,
    refund_payment,
    refresh_status_from_wompi,
)

router = APIRouter(prefix="/payments", tags=["Payments"])
settings = get_settings()


BANKS_CATALOG = [
    {"code": "1007", "name": "Bancolombia"},
    {"code": "1001", "name": "Banco de Bogota"},
    {"code": "1002", "name": "Banco Popular"},
    {"code": "1006", "name": "Banco ITAU"},
    {"code": "1019", "name": "Scotiabank Colpatria"},
    {"code": "1023", "name": "Banco Davivienda"},
    {"code": "1032", "name": "Banco Caja Social"},
    {"code": "1062", "name": "Banco Falabella"},
]


def _validate_student_scope(user: dict, student_id: int) -> None:
    if user.get("role") == "estudiante":
        my_student_id = resolve_student_id(user)
        if student_id != my_student_id:
            raise HTTPException(status_code=403, detail="Solo puedes operar sobre tus propios pagos")


def _session_to_dict(session: models.PaymentSession, payment: models.Payment | None = None) -> dict:
    return {
        "session_token": session.session_token,
        "student_id": session.student_id,
        "amount": session.amount,
        "concept": session.concept,
        "method": session.method,
        "status": session.status,
        "redirect_url": session.redirect_url,
        "reference": payment.reference if payment else None,
        "payment_id": payment.id if payment else session.payment_id,
    }


@router.get("/banks")
def list_banks():
    return BANKS_CATALOG


@router.get("/me", response_model=list[schemas.PaymentResponse])
def get_my_payments(
    user=Depends(require_roles(["admin", "estudiante"])),
    db: Session = Depends(get_db),
):
    if user.get("role") == "admin":
        raise HTTPException(status_code=403, detail="Este endpoint es solo para estudiantes")
    my_student_id = resolve_student_id(user)
    return crud.list_payments_by_student(db, my_student_id)


@router.get("/me/summary")
def get_my_summary(
    user=Depends(require_roles(["admin", "estudiante"])),
    db: Session = Depends(get_db),
):
    if user.get("role") == "admin":
        raise HTTPException(status_code=403, detail="Este endpoint es solo para estudiantes")
    my_student_id = resolve_student_id(user)
    account = crud.get_financial_account(db, my_student_id)
    if not account:
        raise HTTPException(status_code=404, detail="Cuenta financiera no encontrada")
    return {
        "student_id": account.student_id,
        "total_debt": account.total_debt,
        "total_paid": account.total_paid,
        "balance": account.balance,
        "status": account.status,
    }


@router.get("/me/debts")
def get_my_debts(
    user=Depends(require_roles(["admin", "estudiante"])),
    db: Session = Depends(get_db),
):
    if user.get("role") == "admin":
        raise HTTPException(status_code=403, detail="Este endpoint es solo para estudiantes")
    my_student_id = resolve_student_id(user)
    account = crud.get_financial_account(db, my_student_id)
    if not account:
        return {"student_id": my_student_id, "balance": 0, "has_debt": False}
    return {
        "student_id": my_student_id,
        "total_debt": account.total_debt,
        "total_paid": account.total_paid,
        "balance": account.balance,
        "has_debt": account.balance > 0,
        "status": account.status,
    }


@router.post("/initiate")
def initiate_payment(
    payload: dict = Body(...),
    user=Depends(require_roles(["admin", "estudiante"])),
    db: Session = Depends(get_db),
):
    try:
        student_id = int(payload.get("student_id") or 0)
        amount = int(payload.get("amount") or 0)
        concept = str(payload.get("concept") or "Pago academico")
        method_raw = str(payload.get("method") or "pse").lower()
        method = "pse" if method_raw == "bancolombia" else method_raw

        if student_id <= 0:
            raise HTTPException(status_code=400, detail="student_id es requerido")
        if amount < 1000:
            raise HTTPException(status_code=400, detail="El monto minimo es 1000 COP")
        if method not in {"pse", "nequi", "tarjeta"}:
            raise HTTPException(status_code=400, detail="Metodo de pago no soportado")

        _validate_student_scope(user, student_id)

        customer_email = str(user.get("sub") or "estudiante@ucc.edu.co")
        if "@" not in customer_email:
            customer_email = "estudiante@ucc.edu.co"

        # Flujo de compatibilidad UI: crea un pago local estable y una sesion para Nequi/PSE/Tarjeta.
        # La confirmacion/rechazo posterior actualiza estado (aprobado/rechazado) sin depender de Wompi en este punto.
        reference = crud.build_reference(student_id)
        signature = build_integrity_signature(
            reference=reference,
            amount_in_cents=amount * 100,
            currency="COP",
            integrity_secret=settings.wompi_integrity_secret,
        )
        payment = crud.create_payment(
            db,
            student_id=student_id,
            amount_in_cents=amount * 100,
            currency="COP",
            payment_method=method,
            reference=reference,
            concept=concept,
            description=f"Pago iniciado por {method.upper()}",
            customer_email=customer_email,
            integrity_signature=signature,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=settings.payment_expiration_minutes),
            checkout_url=None,
            enrollment_id=None,
            course_id=None,
            academic_order_id=None,
            metadata={
                "legacy_method": method,
                "bank_code": payload.get("bank_code"),
                "phone": payload.get("phone"),
            },
        )

        session_token = secrets.token_urlsafe(24)
        session = models.PaymentSession(
            session_token=session_token,
            student_id=student_id,
            amount=amount,
            concept=concept,
            method=method,
            bank_code=payload.get("bank_code"),
            phone=payload.get("phone"),
            status="pending",
            redirect_url=f"/session/{session_token}/bank" if method == "pse" else None,
            payment_id=payment.id if payment else None,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=15),
        )
        db.add(session)
        db.commit()
        db.refresh(session)

        return _session_to_dict(session, payment)
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"No se pudo iniciar el pago: {str(exc)}")


@router.get("/session/{session_token}")
def get_session_status(
    session_token: str,
    user=Depends(require_roles(["admin", "estudiante"])),
    db: Session = Depends(get_db),
):
    session = (
        db.query(models.PaymentSession)
        .filter(models.PaymentSession.session_token == session_token)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Sesion de pago no encontrada")

    _validate_student_scope(user, session.student_id)
    payment = crud.get_payment(db, session.payment_id) if session.payment_id else None
    return _session_to_dict(session, payment)


@router.post("/session/{session_token}/confirm")
def confirm_session_payment(
    session_token: str,
    user=Depends(require_roles(["admin", "estudiante"])),
    db: Session = Depends(get_db),
):
    session = (
        db.query(models.PaymentSession)
        .filter(models.PaymentSession.session_token == session_token)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Sesion de pago no encontrada")

    _validate_student_scope(user, session.student_id)
    session.status = "approved"
    session.confirmed_at = datetime.now(timezone.utc)

    payment = crud.get_payment(db, session.payment_id) if session.payment_id else None
    if payment:
        payment = crud.apply_transaction_status(
            db,
            payment,
            {
                "id": payment.wompi_transaction_id or f"SIM-{payment.id}",
                "reference": payment.reference,
                "status": "APPROVED",
                "status_message": "Confirmado en flujo de compatibilidad",
            },
        )
    else:
        db.commit()

    db.refresh(session)
    return _session_to_dict(session, payment)


@router.post("/session/{session_token}/reject")
def reject_session_payment(
    session_token: str,
    user=Depends(require_roles(["admin", "estudiante"])),
    db: Session = Depends(get_db),
):
    session = (
        db.query(models.PaymentSession)
        .filter(models.PaymentSession.session_token == session_token)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Sesion de pago no encontrada")

    _validate_student_scope(user, session.student_id)
    session.status = "rejected"

    payment = crud.get_payment(db, session.payment_id) if session.payment_id else None
    if payment:
        payment = crud.apply_transaction_status(
            db,
            payment,
            {
                "id": payment.wompi_transaction_id or f"SIM-{payment.id}",
                "reference": payment.reference,
                "status": "DECLINED",
                "status_message": "Rechazado en flujo de compatibilidad",
            },
        )
    else:
        db.commit()

    db.refresh(session)
    return _session_to_dict(session, payment)


@router.get("/session/{session_token}/bank", response_class=HTMLResponse)
def bank_portal_page(session_token: str):
    return f"""
    <html>
      <head><meta charset=\"utf-8\"><title>Portal bancario simulado</title></head>
      <body style=\"font-family:Arial,sans-serif;background:#0d1324;color:#fff;padding:24px;\">
        <h2>Portal bancario simulado (PSE)</h2>
        <p>Sesion: <strong>{session_token}</strong></p>
        <p>Haz clic para enviar el resultado al SGAU.</p>
        <button onclick=\"window.opener.postMessage({{type:'PSE_CONFIRM',token:'{session_token}'}}, '*');window.close();\" style=\"margin-right:8px;padding:10px 14px;\">Aprobar pago</button>
        <button onclick=\"window.opener.postMessage({{type:'PSE_CANCEL',token:'{session_token}'}}, '*');window.close();\" style=\"padding:10px 14px;\">Cancelar</button>
      </body>
    </html>
    """


@router.post("/accounts", response_model=schemas.FinancialAccountResponse)
def create_account(
    payload: schemas.FinancialAccountCreate,
    user=Depends(require_roles(["admin", "system"])),
    db: Session = Depends(get_db),
):
    _ = user
    return crud.get_or_create_financial_account(db, payload.student_id)


@router.post("/accounts/{student_id}/debt", response_model=schemas.FinancialAccountResponse)
def add_debt(
    student_id: int,
    payload: schemas.DebtUpdate,
    user=Depends(require_roles(["admin"])),
    db: Session = Depends(get_db),
):
    _ = user
    return crud.add_debt(db, student_id, payload.amount)


@router.get("/accounts/{student_id}", response_model=schemas.FinancialAccountResponse)
def get_account(
    student_id: int,
    user=Depends(require_roles(["admin", "estudiante"])),
    db: Session = Depends(get_db),
):
    _validate_student_scope(user, student_id)
    account = crud.get_financial_account(db, student_id)
    if not account:
        raise HTTPException(status_code=404, detail="Cuenta financiera no encontrada")
    return account


@router.post("/create", response_model=schemas.PaymentCreateResponse)
def create_payment_route(
    payload: schemas.PaymentCreateRequest,
    user=Depends(require_roles(["admin", "estudiante"])),
    db: Session = Depends(get_db),
):
    _validate_student_scope(user, payload.student_id)
    return create_payment(db, payload)


@router.get("/status/{reference}", response_model=schemas.PaymentStatusResponse)
def get_status_by_reference(
    reference: str,
    user=Depends(require_roles(["admin", "estudiante"])),
    db: Session = Depends(get_db),
):
    payment = crud.get_payment_by_reference(db, reference)
    if not payment:
        raise HTTPException(status_code=404, detail="Referencia no encontrada")
    _validate_student_scope(user, payment.student_id)

    payment = refresh_status_from_wompi(db, payment)
    return schemas.PaymentStatusResponse(
        reference=payment.reference,
        status=payment.status,
        wompi_status=payment.wompi_status,
        wompi_transaction_id=payment.wompi_transaction_id,
        checkout_url=payment.checkout_url,
    )


@router.post("/webhook", response_model=schemas.WebhookAck)
def webhook(
    request: Request,
    payload: dict = Body(...),
    db: Session = Depends(get_db),
):
    _ = request
    return process_webhook(db, payload)


@router.post("/refund", response_model=schemas.RefundResponse)
def refund(
    payload: schemas.RefundRequest,
    user=Depends(require_roles(["admin"])),
    db: Session = Depends(get_db),
):
    _ = user
    payment = None
    if payload.payment_id is not None:
        payment = crud.get_payment(db, payload.payment_id)
    elif payload.reference:
        payment = crud.get_payment_by_reference(db, payload.reference)

    if not payment:
        raise HTTPException(status_code=404, detail="Pago no encontrado para reembolso")

    return refund_payment(db, payment, payload)


@router.get("/student/{student_id}", response_model=list[schemas.PaymentResponse])
def get_student_payments(
    student_id: int,
    user=Depends(require_roles(["admin", "estudiante"])),
    db: Session = Depends(get_db),
):
    _validate_student_scope(user, student_id)
    return crud.list_payments_by_student(db, student_id)


@router.get("/student/{student_id}/summary")
def get_student_summary(
    student_id: int,
    user=Depends(require_roles(["admin", "estudiante"])),
    db: Session = Depends(get_db),
):
    _validate_student_scope(user, student_id)
    account = crud.get_financial_account(db, student_id)
    if not account:
        raise HTTPException(status_code=404, detail="Cuenta financiera no encontrada")
    return {
        "student_id": account.student_id,
        "total_debt": account.total_debt,
        "total_paid": account.total_paid,
        "balance": account.balance,
        "status": account.status,
    }


@router.get("/{payment_id}", response_model=schemas.PaymentResponse)
def get_payment_by_id(
    payment_id: int,
    user=Depends(require_roles(["admin", "estudiante"])),
    db: Session = Depends(get_db),
):
    payment = crud.get_payment(db, payment_id)
    if not payment:
        raise HTTPException(status_code=404, detail="Pago no encontrado")
    _validate_student_scope(user, payment.student_id)
    return payment


@router.get("/health")
def health_check():
    return {"status": "ok", "service": "payment-service"}
