from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator
from sqlalchemy import text
from app.database import engine, Base, SessionLocal
import app.models as models
from app.auth import hash_password
from app.routes import router

app = FastAPI(title="Auth Service")
Instrumentator().instrument(app).expose(app, include_in_schema=False)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

Base.metadata.create_all(bind=engine)

# Ensure auth DB has the optional profile columns without requiring a migration tool.
with engine.connect() as conn:
    conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(100)"))
    conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(100)"))
    conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS document_id VARCHAR(50)"))
    conn.commit()


def ensure_seed_admin_user():
    seed_email = "admin@ucc.edu.co"
    seed_password = "Admin123*"

    db = SessionLocal()
    try:
        existing = db.query(models.User).filter(models.User.email == seed_email).first()
        if existing:
            return

        seed_admin = models.User(
            email=seed_email,
            password=hash_password(seed_password),
            role="admin",
            first_name="Admin",
            last_name="SGAU",
            document_id="ADMIN-SEED-001",
        )
        db.add(seed_admin)
        db.commit()
        db.refresh(seed_admin)
    finally:
        db.close()


ensure_seed_admin_user()

app.include_router(router, prefix="/auth")

@app.get("/")
def home():
    return {"mensaje": "Auth Service funcionando"}

@app.get("/health")
def health():
    return {"status": "ok", "service": "auth"}