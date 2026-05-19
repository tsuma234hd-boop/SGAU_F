from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, FileResponse
from fastapi.staticfiles import StaticFiles
from prometheus_fastapi_instrumentator import Instrumentator
import httpx
import os

app = FastAPI(title="SGAU API Gateway", version="1.0.0")
Instrumentator().instrument(app).expose(app, include_in_schema=False)

HTML_NO_CACHE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
}

# ─── CORS ────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # En producción usa dominios específicos
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Archivos estáticos ──────────────────────────────────────────────────────
current_dir = os.path.dirname(os.path.abspath(__file__))
app.mount("/static", StaticFiles(directory=current_dir), name="static")

# ─── URLs internas de microservicios (Docker) ─────────────────────────────────
AUTH_SERVICE_URL      = "http://auth-service:8000"
STUDENT_SERVICE_URL   = "http://student_service:8000"
ACADEMIC_SERVICE_URL  = "http://academic_service:8000"
ENROLLMENT_SERVICE_URL = "http://enrollment_service:8000"
GRADES_SERVICE_URL = "http://grades_service:8000"
PAYMENT_SERVICE_URL = "http://payment_service:8000"
REPORTING_SERVICE_URL = "http://reporting_service:8001"

TIMEOUT = 10.0  # segundos


# ─── Helpers ──────────────────────────────────────────────────────────────────
def _forward_headers(request: Request) -> dict:
    """Pasa solo los headers relevantes al microservicio."""
    headers = {}
    if "authorization" in request.headers:
        headers["Authorization"] = request.headers["authorization"]

    if "content-type" in request.headers:
        headers["Content-Type"] = request.headers["content-type"]

    if "x-event-checksum" in request.headers:
        headers["X-Event-Checksum"] = request.headers["x-event-checksum"]

    return headers


def _with_query(url: str, request: Request) -> str:
    query = str(request.url.query or "")
    if not query:
        return url
    return f"{url}?{query}"


async def _proxy(method: str, url: str, headers: dict, body: bytes):
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.request(method, url, headers=headers, content=body)
            content_type = response.headers.get("content-type", "")

            # Las respuestas 204 No Content no deben tener cuerpo ni Content-Type
            if response.status_code == 204:
                return Response(status_code=204)

            if "application/json" in content_type:
                data = response.json()
                return JSONResponse(content=data, status_code=response.status_code)

            return Response(content=response.content, status_code=response.status_code, media_type=content_type or "text/plain")
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail=f"Servicio no disponible: {url}")
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Tiempo de espera agotado")


# ─── Health Check ─────────────────────────────────────────────────────────────
@app.get("/health", tags=["Gateway"])
async def health():
    results = {}
    async with httpx.AsyncClient(timeout=3.0) as client:
        for name, url in [
            ("auth-service", AUTH_SERVICE_URL),
            ("student-service", STUDENT_SERVICE_URL),
            ("academic-service", ACADEMIC_SERVICE_URL),
            ("enrollment-service", ENROLLMENT_SERVICE_URL),
            ("grades-service", GRADES_SERVICE_URL),
            ("payment-service", PAYMENT_SERVICE_URL),
            ("reporting-service", REPORTING_SERVICE_URL),
        ]:
            try:
                r = await client.get(f"{url}/health")
                results[name] = "ok" if r.status_code == 200 else "degraded"
            except Exception:
                results[name] = "down"
    return {"gateway": "ok", "services": results}


# ─── Proxy Auth ───────────────────────────────────────────────────────────────
@app.api_route(
        "/auth/{path:path}",
        methods=["GET", "POST", "PUT", "DELETE"], 
        tags=["Auth"])

async def auth_proxy(path: str, request: Request):
    url = _with_query(f"{AUTH_SERVICE_URL}/auth/{path}", request)
    return await _proxy(
        request.method,
        url,
        _forward_headers(request),
        await request.body(),
    )


# ─── Proxy Students ───────────────────────────────────────────────────────────
@app.api_route(
        "/students/{path:path}", 
        methods=["GET", "POST", "PUT", "DELETE"], 
        tags=["Students"])
async def student_proxy(path: str, request: Request):
    url = _with_query(f"{STUDENT_SERVICE_URL}/students/{path}", request)
    return await _proxy(
        request.method,
        url,
        _forward_headers(request),
        await request.body(),
    )

@app.api_route(
        "/academic/{path:path}", 
        methods=["GET", "POST", "PUT", "DELETE"], 
        tags=["Academic"])
async def academic_proxy(path: str, request: Request):
    url = _with_query(f"{ACADEMIC_SERVICE_URL}/{path}", request)
    return await _proxy(
        request.method,
        url,
        _forward_headers(request),
        await request.body(),
    )

@app.api_route(
        "/academic",
        methods=["GET", "POST", "PUT", "DELETE"],
        tags=["Academic"])
async def academic_proxy_root(request: Request):
    url = _with_query(f"{ACADEMIC_SERVICE_URL}/", request)
    return await _proxy(
        request.method,
        url,
        _forward_headers(request),
        await request.body(),
    )

@app.api_route(
        "/enrollments/{path:path}", 
        methods=["GET", "POST", "PUT", "DELETE"], 
        tags=["Enrollments"])
async def enrollment_proxy(path: str, request: Request):
    url = _with_query(f"{ENROLLMENT_SERVICE_URL}/enrollments/{path}", request)
    return await _proxy(
        request.method,
        url,
        _forward_headers(request),
        await request.body(),
    )

@app.api_route(
        "/enrollments",
        methods=["GET", "POST", "PUT", "DELETE"],
        tags=["Enrollments"])
async def enrollment_proxy_root(request: Request):
    url = _with_query(f"{ENROLLMENT_SERVICE_URL}/enrollments/", request)
    return await _proxy(
        request.method,
        url,
        _forward_headers(request),
        await request.body(),
    )

@app.api_route(
        "/grades/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
        tags=["Grades"])
async def grades_proxy(path: str, request: Request):
    url = _with_query(f"{GRADES_SERVICE_URL}/grades/{path}", request)
    return await _proxy(
        request.method,
        url,
        _forward_headers(request),
        await request.body(),
    )

@app.api_route(
        "/grades",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
        tags=["Grades"])
async def grades_proxy_root(request: Request):
    url = _with_query(f"{GRADES_SERVICE_URL}/grades/", request)
    return await _proxy(
        request.method,
        url,
        _forward_headers(request),
        await request.body(),
    )

@app.api_route(
        "/payments/{path:path}",
        methods=["GET", "POST", "PUT", "DELETE"],
        tags=["Payments"])
async def payments_proxy(path: str, request: Request):
    url = _with_query(f"{PAYMENT_SERVICE_URL}/payments/{path}", request)
    return await _proxy(
        request.method,
        url,
        _forward_headers(request),
        await request.body(),
    )

@app.api_route(
        "/payments",
        methods=["GET", "POST", "PUT", "DELETE"],
        tags=["Payments"])
async def payments_proxy_root(request: Request):
    url = _with_query(f"{PAYMENT_SERVICE_URL}/payments", request)
    return await _proxy(
        request.method,
        url,
        _forward_headers(request),
        await request.body(),
    )

@app.api_route(
        "/reports/{path:path}",
        methods=["GET", "POST", "PUT", "DELETE"],
        tags=["Reports"])
async def reports_proxy(path: str, request: Request):
    url = _with_query(f"{REPORTING_SERVICE_URL}/reports/{path}", request)
    return await _proxy(
        request.method,
        url,
        _forward_headers(request),
        await request.body(),
    )

@app.api_route(
        "/reports",
        methods=["GET", "POST", "PUT", "DELETE"],
        tags=["Reports"])
async def reports_proxy_root(request: Request):
    url = _with_query(f"{REPORTING_SERVICE_URL}/reports", request)
    return await _proxy(
        request.method,
        url,
        _forward_headers(request),
        await request.body(),
    )

@app.get("/")
def serve_login():
    return FileResponse(os.path.join(current_dir, "login.html"), headers=HTML_NO_CACHE_HEADERS)

@app.get("/dashboard")
def serve_dashboard_alias():
    return FileResponse(os.path.join(current_dir, "index.html"), headers=HTML_NO_CACHE_HEADERS)

@app.get("/admin")
def serve_admin_dashboard():
    return FileResponse(os.path.join(current_dir, "index.html"), headers=HTML_NO_CACHE_HEADERS)

@app.get("/index.html")
def serve_dashboard():
    return FileResponse(os.path.join(current_dir, "index.html"), headers=HTML_NO_CACHE_HEADERS)
