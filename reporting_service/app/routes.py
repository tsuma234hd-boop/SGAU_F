from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from app.services import (
    get_student_average, get_course_report, get_student_financial_report,
    export_student_csv, export_student_pdf,
    export_course_csv, export_course_pdf,
)
from app.auth import require_roles, resolve_student_id

router = APIRouter()


# ── Endpoints JSON existentes ────────────────────────────────────────────────

@router.get("/reports/student/{student_id}")
def student_report(student_id: int, user=Depends(require_roles(["admin", "estudiante"]))):
    if user.get("role") == "estudiante":
        my_student_id = resolve_student_id(user)
        if student_id != my_student_id:
            raise HTTPException(status_code=403, detail="Solo puedes ver tus reportes")
    return get_student_average(student_id, user.get("token"))


@router.get("/reports/course/{course_id}")
def course_report(course_id: int, user=Depends(require_roles(["admin"]))):
    return get_course_report(course_id, user.get("token"))


@router.get("/reports/student/{student_id}/financial")
def student_financial_report(student_id: int, user=Depends(require_roles(["admin", "estudiante"]))):
    if user.get("role") == "estudiante":
        my_student_id = resolve_student_id(user)
        if student_id != my_student_id:
            raise HTTPException(status_code=403, detail="Solo puedes ver tus reportes")
    return get_student_financial_report(student_id, user.get("token"))


# ── Endpoints de exportación ─────────────────────────────────────────────────

@router.get("/reports/student/{student_id}/export")
def export_student_report(
    student_id: int,
    format: str = Query("pdf", regex="^(pdf|csv)$"),
    user=Depends(require_roles(["admin", "estudiante"])),
):
    if user.get("role") == "estudiante":
        my_student_id = resolve_student_id(user)
        if student_id != my_student_id:
            raise HTTPException(status_code=403, detail="Solo puedes exportar tus propios reportes")

    token = user.get("token")
    if format == "csv":
        content = export_student_csv(student_id, token)
        return Response(
            content=content,
            media_type="text/csv; charset=utf-8-sig",
            headers={"Content-Disposition": f"attachment; filename=reporte_estudiante_{student_id}.csv"},
        )
    else:
        content = export_student_pdf(student_id, token)
        return Response(
            content=content,
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename=reporte_estudiante_{student_id}.pdf"},
        )


@router.get("/reports/course/{course_id}/export")
def export_course_report(
    course_id: int,
    format: str = Query("pdf", regex="^(pdf|csv)$"),
    user=Depends(require_roles(["admin"])),
):
    token = user.get("token")
    if format == "csv":
        content = export_course_csv(course_id, token)
        return Response(
            content=content,
            media_type="text/csv; charset=utf-8-sig",
            headers={"Content-Disposition": f"attachment; filename=reporte_curso_{course_id}.csv"},
        )
    else:
        content = export_course_pdf(course_id, token)
        return Response(
            content=content,
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename=reporte_curso_{course_id}.pdf"},
        )