from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator
from app.db import engine, Base
from app.routes import router

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Grades Service")
Instrumentator().instrument(app).expose(app, include_in_schema=False)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/grades")

@app.get("/")
def root():
    return {"message": "Grades Service funcionando"}

@app.get("/health")
def health():
    return {"status": "ok", "service": "grades"}