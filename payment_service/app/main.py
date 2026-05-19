import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator
from sqlalchemy import inspect, text

from .core.config import get_settings
from .db import Base, engine
from . import models  # noqa: F401
from .routes import router

settings = get_settings()
logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(title=settings.app_name)
Instrumentator().instrument(app).expose(app, include_in_schema=False)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

Base.metadata.create_all(bind=engine)


def ensure_payment_schema():
    inspector = inspect(engine)
    if "payments" in inspector.get_table_names():
        with engine.connect() as conn:
            conn.execute(text("ALTER TABLE payments ADD COLUMN IF NOT EXISTS amount_in_cents INTEGER"))
            conn.execute(text("ALTER TABLE payments ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'COP'"))
            conn.execute(text("ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_method_type VARCHAR(50)"))
            conn.execute(text("ALTER TABLE payments ADD COLUMN IF NOT EXISTS checkout_url TEXT"))
            conn.execute(text("ALTER TABLE payments ADD COLUMN IF NOT EXISTS redirect_url TEXT"))
            conn.execute(text("ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider VARCHAR(50) DEFAULT 'wompi'"))
            conn.execute(text("ALTER TABLE payments ADD COLUMN IF NOT EXISTS customer_email VARCHAR(255)"))
            conn.execute(text("ALTER TABLE payments ADD COLUMN IF NOT EXISTS wompi_transaction_id VARCHAR(120)"))
            conn.execute(text("ALTER TABLE payments ADD COLUMN IF NOT EXISTS wompi_payment_link_id VARCHAR(120)"))
            conn.execute(text("ALTER TABLE payments ADD COLUMN IF NOT EXISTS wompi_status VARCHAR(50)"))
            conn.execute(text("ALTER TABLE payments ADD COLUMN IF NOT EXISTS wompi_status_message VARCHAR(255)"))
            conn.execute(text("ALTER TABLE payments ADD COLUMN IF NOT EXISTS integrity_signature VARCHAR(128)"))
            conn.execute(text("ALTER TABLE payments ADD COLUMN IF NOT EXISTS webhook_verified BOOLEAN DEFAULT FALSE"))
            conn.execute(text("ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_status VARCHAR(50)"))
            conn.execute(text("ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_id VARCHAR(120)"))
            conn.execute(text("ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_reason VARCHAR(255)"))
            conn.execute(text("ALTER TABLE payments ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ"))
            conn.execute(text("ALTER TABLE payments ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ"))
            conn.execute(text("ALTER TABLE payments ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ"))
            conn.execute(text("ALTER TABLE payments ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ"))
            conn.execute(text("ALTER TABLE payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()"))
            conn.execute(text("ALTER TABLE payments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()"))
            conn.execute(text("ALTER TABLE payments ADD COLUMN IF NOT EXISTS enrollment_id INTEGER"))
            conn.execute(text("ALTER TABLE payments ADD COLUMN IF NOT EXISTS course_id INTEGER"))
            conn.execute(text("ALTER TABLE payments ADD COLUMN IF NOT EXISTS academic_order_id VARCHAR(100)"))
            conn.execute(text("ALTER TABLE payments ADD COLUMN IF NOT EXISTS metadata_json JSONB"))
            conn.execute(text("ALTER TABLE payments ADD COLUMN IF NOT EXISTS wompi_raw_response JSONB"))
            conn.execute(text("UPDATE payments SET amount_in_cents = amount * 100 WHERE amount_in_cents IS NULL"))
            conn.execute(text("UPDATE payments SET status = 'pendiente' WHERE status = 'pending'"))
            conn.execute(text("UPDATE payments SET status = 'aprobado' WHERE status = 'approved'"))
            conn.execute(text("UPDATE payments SET status = 'rechazado' WHERE status = 'rejected'"))
            conn.execute(text("UPDATE payments SET status = 'expirado' WHERE status = 'expired'"))
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS payment_sessions (
                        id SERIAL PRIMARY KEY,
                        session_token VARCHAR(64) UNIQUE NOT NULL,
                        student_id INTEGER NOT NULL,
                        amount INTEGER NOT NULL,
                        concept VARCHAR(100),
                        method VARCHAR(50) NOT NULL,
                        bank_code VARCHAR(20),
                        phone VARCHAR(20),
                        status VARCHAR(30) DEFAULT 'pending',
                        redirect_url VARCHAR(255),
                        payment_id INTEGER,
                        expires_at TIMESTAMPTZ,
                        confirmed_at TIMESTAMPTZ,
                        created_at TIMESTAMPTZ DEFAULT NOW()
                    )
                    """
                )
            )
            conn.execute(text("ALTER TABLE payment_sessions ADD COLUMN IF NOT EXISTS session_token VARCHAR(64)"))
            conn.execute(text("ALTER TABLE payment_sessions ADD COLUMN IF NOT EXISTS student_id INTEGER"))
            conn.execute(text("ALTER TABLE payment_sessions ADD COLUMN IF NOT EXISTS amount INTEGER"))
            conn.execute(text("ALTER TABLE payment_sessions ADD COLUMN IF NOT EXISTS concept VARCHAR(100)"))
            conn.execute(text("ALTER TABLE payment_sessions ADD COLUMN IF NOT EXISTS method VARCHAR(50)"))
            conn.execute(text("ALTER TABLE payment_sessions ADD COLUMN IF NOT EXISTS bank_code VARCHAR(20)"))
            conn.execute(text("ALTER TABLE payment_sessions ADD COLUMN IF NOT EXISTS phone VARCHAR(20)"))
            conn.execute(text("ALTER TABLE payment_sessions ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'pending'"))
            conn.execute(text("ALTER TABLE payment_sessions ADD COLUMN IF NOT EXISTS redirect_url VARCHAR(255)"))
            conn.execute(text("ALTER TABLE payment_sessions ADD COLUMN IF NOT EXISTS payment_id INTEGER"))
            conn.execute(text("ALTER TABLE payment_sessions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ"))
            conn.execute(text("ALTER TABLE payment_sessions ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ"))
            conn.execute(text("ALTER TABLE payment_sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()"))
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_sessions_session_token ON payment_sessions(session_token)"))
            conn.commit()

    Base.metadata.create_all(bind=engine)

ensure_payment_schema()

app.include_router(router)


@app.get("/")
def root():
    return {"message": "Payment Service funcionando", "provider": "Wompi"}


@app.get("/health")
def health():
    return {"status": "ok", "service": "payment-service"}


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Error no controlado en payment_service %s", request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Error interno del servicio de pagos"})
