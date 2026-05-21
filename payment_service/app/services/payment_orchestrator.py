from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app import crud, models, schemas
from app.core.config import get_settings
from app.core.security import build_integrity_signature, validate_wompi_webhook_signature
from app.services.wompi_client import WompiClient

logger = logging.getLogger(__name__)
settings = get_settings()
wompi_client = WompiClient()


def _ensure_unique_reference(db: Session, reference: str) -> None:
    if crud.get_payment_by_reference(db, reference):
        raise HTTPException(status_code=409, detail="Ya existe un pago con la referencia indicada")


def _expiration(payload: schemas.PaymentCreateRequest) -> datetime:
    if payload.expires_at:
        return payload.expires_at
    return datetime.now(timezone.utc) + timedelta(minutes=settings.payment_expiration_minutes)


def _payment_link_payload(payment: models.Payment) -> dict[str, Any]:
    return {
        "name": payment.concept or "Pago academico SGAU",
        "description": payment.description or "Pago universitario",
        "single_use": True,
        "collect_shipping": False,
        "currency": payment.currency,
        "amount_in_cents": payment.amount_in_cents,
        "expires_at": payment.expires_at.isoformat() if payment.expires_at else None,
        "redirect_url": payment.checkout_url,
        "reference": payment.reference,
        "customer_data": {
            "email": payment.customer_email,
        },
    }


def create_payment(db: Session, payload: schemas.PaymentCreateRequest) -> schemas.PaymentCreateResponse:
    reference = payload.reference or crud.build_reference(payload.student_id)
    _ensure_unique_reference(db, reference)
    expires_at = _expiration(payload)
    redirect_url = payload.redirect_url or settings.payment_link_redirect_url

    integrity_signature = build_integrity_signature(
        reference=reference,
        amount_in_cents=payload.amount_in_cents,
        currency="COP",
        integrity_secret=settings.wompi_integrity_secret,
    )

    payment = crud.create_payment(
        db,
        student_id=payload.student_id,
        amount_in_cents=payload.amount_in_cents,
        currency="COP",
        payment_method=payload.payment_method,
        reference=reference,
        concept=payload.concept,
        description=payload.description,
        customer_email=payload.customer_email,
        integrity_signature=integrity_signature,
        expires_at=expires_at,
        checkout_url=redirect_url,
        enrollment_id=payload.enrollment_id,
        course_id=payload.course_id,
        academic_order_id=payload.academic_order_id,
        metadata=payload.metadata,
    )

    try:
        if payload.payment_method == "checkout":
            link_payload = _payment_link_payload(payment)
            wompi_response = wompi_client.create_payment_link(link_payload)
            data = wompi_response.get("data") or {}
            payment.wompi_payment_link_id = data.get("id")
            payment.checkout_url = data.get("permalink") or data.get("url") or payment.checkout_url
            payment.wompi_raw_response = wompi_response
            db.commit()
            db.refresh(payment)
            crud.record_attempt(
                db,
                payment_id=payment.id,
                action="create_link",
                endpoint="/payment_links",
                success=True,
                status_code=200,
                error_message=None,
            )
            return schemas.PaymentCreateResponse(
                payment=schemas.PaymentResponse.model_validate(payment),
                checkout_url=payment.checkout_url,
                wompi_link_id=payment.wompi_payment_link_id,
            )

        if not payload.direct_payment:
            raise HTTPException(
                status_code=400,
                detail="Para card, pse o nequi debes enviar direct_payment.payment_source_id",
            )

        merchant = wompi_client.get_merchant_info()
        acceptance_token = ((merchant.get("data") or {}).get("presigned_acceptance") or {}).get("acceptance_token")
        if not acceptance_token:
            raise HTTPException(status_code=502, detail="No fue posible obtener acceptance_token de Wompi")

        transaction_payload = {
            "amount_in_cents": payload.amount_in_cents,
            "currency": "COP",
            "customer_email": payload.customer_email,
            "payment_method_type": payload.payment_method.upper(),
            "payment_source_id": payload.direct_payment.payment_source_id,
            "reference": reference,
            "acceptance_token": acceptance_token,
            "redirect_url": redirect_url,
            "installments": payload.direct_payment.installments,
        }

        wompi_response = wompi_client.create_transaction(transaction_payload)
        transaction = wompi_response.get("data") or {}
        payment = crud.apply_transaction_status(db, payment, transaction)
        payment.wompi_raw_response = wompi_response
        db.commit()
        db.refresh(payment)
        crud.record_attempt(
            db,
            payment_id=payment.id,
            action="create_transaction",
            endpoint="/transactions",
            success=True,
            status_code=200,
            error_message=None,
        )
        return schemas.PaymentCreateResponse(
            payment=schemas.PaymentResponse.model_validate(payment),
            wompi_transaction_id=payment.wompi_transaction_id,
        )

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Error creando pago con Wompi")
        crud.record_attempt(
            db,
            payment_id=payment.id,
            action="create_payment",
            endpoint="/payment_links_or_transactions",
            success=False,
            status_code=None,
            error_message=str(exc)[:250],
        )
        raise HTTPException(status_code=502, detail=f"Error creando pago en Wompi: {exc}") from exc


def refresh_status_from_wompi(db: Session, payment: models.Payment) -> models.Payment:
    if payment.wompi_transaction_id:
        response = wompi_client.get_transaction(payment.wompi_transaction_id)
        transaction = response.get("data") or {}
        return crud.apply_transaction_status(db, payment, transaction)

    if payment.wompi_payment_link_id:
        try:
            from_date = (payment.created_at - timedelta(days=2)).strftime("%Y-%m-%d")
            until_date = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d")
            response = wompi_client.list_transactions(
                from_date=from_date,
                until_date=until_date,
                page=1,
                page_size=100,
                payment_link_id=payment.wompi_payment_link_id,
            )
            transactions = (response.get("data") or []) if isinstance(response, dict) else []
            if transactions:
                # Preferir la transaccion del mismo monto y la mas reciente.
                matching = [
                    tx for tx in transactions
                    if int(tx.get("amount_in_cents") or 0) == int(payment.amount_in_cents or 0)
                ]
                pool = matching or transactions
                latest = sorted(
                    pool,
                    key=lambda tx: str(tx.get("finalized_at") or tx.get("created_at") or ""),
                    reverse=True,
                )[0]
                return crud.apply_transaction_status(db, payment, latest)
        except Exception:
            logger.exception("No fue posible refrescar por payment_link_id para %s", payment.reference)

    response = wompi_client.get_transactions_by_reference(payment.reference)
    transactions = (response.get("data") or []) if isinstance(response, dict) else []
    if transactions:
        latest = transactions[0]
        return crud.apply_transaction_status(db, payment, latest)

    if payment.expires_at and payment.expires_at < datetime.now(timezone.utc) and payment.status == "pendiente":
        payment.status = "expirado"
        payment.expired_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(payment)
    return payment


def process_webhook(db: Session, payload: dict[str, Any]) -> schemas.WebhookAck:
    signature = payload.get("signature") or {}
    checksum = signature.get("checksum")
    signature_ok = validate_wompi_webhook_signature(
        payload=payload,
        events_secret=settings.wompi_events_secret,
        tolerance_seconds=settings.webhook_tolerance_seconds,
    )
    transaction = ((payload.get("data") or {}).get("transaction") or {})

    if not signature_ok:
        crud.save_webhook_event(
            db,
            event=payload.get("event") or "unknown",
            checksum=checksum,
            transaction_id=transaction.get("id"),
            reference=transaction.get("reference"),
            status=transaction.get("status"),
            environment=payload.get("environment"),
            payload=payload,
            processed=False,
            error="firma invalida",
        )
        raise HTTPException(status_code=401, detail="Firma de webhook invalida")

    payment = None
    if transaction.get("id"):
        payment = crud.get_payment_by_transaction_id(db, str(transaction.get("id")))
    if not payment and transaction.get("reference"):
        payment = crud.get_payment_by_reference(db, str(transaction.get("reference")))

    processed = False
    ref = None
    if payment:
        ref = payment.reference
        payment.webhook_verified = True
        payment = crud.apply_transaction_status(db, payment, transaction)
        processed = True

    crud.save_webhook_event(
        db,
        event=payload.get("event") or "unknown",
        checksum=checksum,
        transaction_id=transaction.get("id"),
        reference=transaction.get("reference"),
        status=transaction.get("status"),
        environment=payload.get("environment"),
        payload=payload,
        processed=processed,
        error=None,
    )

    return schemas.WebhookAck(received=True, processed=processed, payment_reference=ref)


def refund_payment(db: Session, payment: models.Payment, request: schemas.RefundRequest) -> schemas.RefundResponse:
    if not payment.wompi_transaction_id:
        raise HTTPException(status_code=400, detail="El pago no tiene transaccion Wompi asociada")

    amount = request.amount_in_cents or payment.amount_in_cents
    payload = {
        "amount_in_cents": amount,
        "reason": request.reason,
    }

    try:
        wompi_response = wompi_client.create_refund(payment.wompi_transaction_id, payload)
        data = wompi_response.get("data") or {}
        payment.refund_id = data.get("id")
        payment.refund_status = data.get("status")
        payment.refund_reason = request.reason
        payment.wompi_raw_response = wompi_response
        db.commit()
        db.refresh(payment)
        crud.record_attempt(
            db,
            payment_id=payment.id,
            action="refund",
            endpoint=f"/transactions/{payment.wompi_transaction_id}/refunds",
            success=True,
            status_code=200,
            error_message=None,
        )
        return schemas.RefundResponse(
            reference=payment.reference,
            status=payment.status,
            refund_status=payment.refund_status,
            wompi_response=wompi_response,
        )
    except Exception as exc:
        logger.exception("Error solicitando refund en Wompi")
        crud.record_attempt(
            db,
            payment_id=payment.id,
            action="refund",
            endpoint=f"/transactions/{payment.wompi_transaction_id}/refunds",
            success=False,
            status_code=None,
            error_message=str(exc)[:250],
        )
        raise HTTPException(status_code=502, detail=f"No fue posible procesar el reembolso: {exc}") from exc
