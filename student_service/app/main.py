from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator
from .db import Base, engine
from .models import Student
from .routes import router
from sqlalchemy import inspect, text
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Student Service")
Instrumentator().instrument(app).expose(app, include_in_schema=False)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

Base.metadata.create_all(bind=engine)

# ── Migración: Asegurar que document_id existe y es indexado ──
def ensure_student_schema():
    """Asegura que la tabla students tiene la columna document_id correctamente configurada"""
    try:
        inspector = inspect(engine)
        if "students" in inspector.get_table_names():
            columns = {col["name"]: col for col in inspector.get_columns("students")}
            
            with engine.connect() as conn:
                # Agregar columna si no existe
                if "document_id" not in columns:
                    logger.info("🔧 Agregando columna document_id a tabla students...")
                    try:
                        conn.execute(text("ALTER TABLE students ADD COLUMN document_id VARCHAR(50)"))
                        conn.commit()
                        logger.info("✓ Columna document_id agregada exitosamente")
                    except Exception as e:
                        logger.warning(f"Nota: {e}")
                else:
                    logger.info("✓ Columna document_id ya existe")
                
                # Crear índice si no existe
                try:
                    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_document_id ON students(document_id)"))
                    conn.commit()
                    logger.info("✓ Índice en document_id creado")
                except Exception as e:
                    logger.warning(f"Nota al crear índice: {e}")
        else:
            logger.info("✓ Tabla students será creada con create_all()")
    except Exception as e:
        logger.error(f"✗ Error en migración: {e}")

ensure_student_schema()

app.include_router(router)

@app.get("/")
def root():
    return {"message": "Student Service funcionando"}

@app.get("/health")
def health():
    return {"status": "ok", "service": "students"}