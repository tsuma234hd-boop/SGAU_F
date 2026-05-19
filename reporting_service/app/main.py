from fastapi import FastAPI
from prometheus_fastapi_instrumentator import Instrumentator
from app.routes import router

app = FastAPI(title="Reporting Service")
Instrumentator().instrument(app).expose(app, include_in_schema=False)

app.include_router(router)

@app.get("/")
def root():
    return {"message": "Reporting Service funcionando"}

@app.get("/health")
def health():
    return {"status": "ok", "service": "reporting"}