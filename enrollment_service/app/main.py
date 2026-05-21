from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator
from sqlalchemy import text
from .database import engine, Base
from .routes import router

app = FastAPI(title="Enrollment Service")
Instrumentator().instrument(app).expose(app, include_in_schema=False)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

Base.metadata.create_all(bind=engine)

with engine.connect() as conn:
    conn.execute(text("ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS section_id INTEGER"))
    conn.commit()

app.include_router(router)

@app.get("/")
def root():
    return {"message": "Enrollment Service funcionando"}

@app.get("/health")
def health():
    return {"status": "ok", "service": "enrollment"}
