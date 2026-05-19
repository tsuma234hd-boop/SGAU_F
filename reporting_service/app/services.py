import csv
import io
from datetime import date

import requests
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import (
    Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
)

GRADES_URL = "http://grades_service:8000"
STUDENTS_URL = "http://student_service:8000"
COURSES_URL = "http://academic_service:8000"
PAYMENT_URL = "http://payment_service:8000"

PRIMARY = colors.HexColor("#4f8ef7")
LIGHT_BG = colors.HexColor("#f0f4ff")
DANGER = colors.HexColor("#e74c3c")
SUCCESS = colors.HexColor("#27ae60")


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _safe_get(url: str, token: str) -> list | dict:
    try:
        r = requests.get(url, headers=_auth_headers(token), timeout=5)
        return r.json() if r.status_code == 200 else {}
    except Exception:
        return {}


# ── Helpers básicos ─────────────────────────────────────────────────────────

def get_student_average(student_id: int, token: str) -> dict:
    grades = _safe_get(f"{GRADES_URL}/grades/students/{student_id}/grades", token)
    if not isinstance(grades, list) or not grades:
        return {"student_id": student_id, "average": 0, "grades": []}
    avg = sum(g.get("score", 0) for g in grades) / len(grades)
    return {"student_id": student_id, "average": round(avg, 2), "grades": grades}


def get_student_financial_summary(student_id: int, token: str) -> dict:
    result = _safe_get(f"{PAYMENT_URL}/payments/student/{student_id}/summary", token)
    return result if result else {"error": "Servicio de pagos no disponible"}


def get_student_financial_report(student_id: int, token: str) -> dict:
    return {
        "student_id": student_id,
        "academic_average": get_student_average(student_id, token),
        "financial_summary": get_student_financial_summary(student_id, token),
    }


def get_course_report(course_id: int, token: str) -> list:
    result = _safe_get(f"{GRADES_URL}/grades/courses/{course_id}/grades", token)
    return result if isinstance(result, list) else []


# ── Datos enriquecidos para exportación ────────────────────────────────────

def _fetch_student_info(student_id: int, token: str) -> dict:
    info = _safe_get(f"{STUDENTS_URL}/students/{student_id}", token)
    return info if isinstance(info, dict) else {}


def _fetch_course_name(course_id: int, token: str) -> str:
    course = _safe_get(f"{COURSES_URL}/api/courses/{course_id}", token)
    if isinstance(course, dict) and course.get("name"):
        return f"{course.get('code', '')} - {course['name']}".strip(" -")
    return f"Curso {course_id}"


def build_student_report_data(student_id: int, token: str) -> dict:
    """Consolida toda la info del estudiante para exportación."""
    student = _fetch_student_info(student_id, token)
    grades_raw = _safe_get(f"{GRADES_URL}/grades/students/{student_id}/grades", token)
    grades = grades_raw if isinstance(grades_raw, list) else []

    rows = []
    for g in grades:
        cname = _fetch_course_name(g.get("course_id", 0), token)
        score = g.get("score")
        rows.append({
            "course_id": g.get("course_id", ""),
            "course": cname,
            "score": f"{float(score):.1f}" if score is not None else "Pendiente",
            "passed": "Aprobó" if score is not None and float(score) >= 3.0 else ("Reprobó" if score is not None else "—"),
        })

    avg = round(sum(float(r["score"]) for r in rows if r["score"] != "Pendiente") / len([r for r in rows if r["score"] != "Pendiente"]), 2) if any(r["score"] != "Pendiente" for r in rows) else 0.0

    financial = get_student_financial_summary(student_id, token)

    return {
        "student": student,
        "grades": rows,
        "average": avg,
        "financial": financial,
    }


def build_course_report_data(course_id: int, token: str) -> dict:
    """Consolida calificaciones de un curso para exportación."""
    course = _safe_get(f"{COURSES_URL}/api/courses/{course_id}", token)
    course_name = f"{course.get('code','')  } - {course.get('name','')}" if isinstance(course, dict) and course.get("name") else f"Curso {course_id}"

    grades_raw = _safe_get(f"{GRADES_URL}/grades/courses/{course_id}/grades", token)
    grades = grades_raw if isinstance(grades_raw, list) else []

    rows = []
    for g in grades:
        student = _fetch_student_info(g.get("student_id", 0), token)
        nombre = f"{student.get('nombre', '')} {student.get('apellido', '')}".strip() or f"ID {g.get('student_id')}"
        score = g.get("score")
        rows.append({
            "student_id": g.get("student_id", ""),
            "student": nombre,
            "email": student.get("email", "—"),
            "score": f"{float(score):.1f}" if score is not None else "Pendiente",
            "passed": "Aprobó" if score is not None and float(score) >= 3.0 else ("Reprobó" if score is not None else "—"),
        })

    scores = [float(r["score"]) for r in rows if r["score"] != "Pendiente"]
    avg = round(sum(scores) / len(scores), 2) if scores else 0.0

    return {
        "course_id": course_id,
        "course_name": course_name.strip(" -"),
        "grades": rows,
        "average": avg,
        "total": len(rows),
        "passed": sum(1 for r in rows if r["passed"] == "Aprobó"),
        "failed": sum(1 for r in rows if r["passed"] == "Reprobó"),
    }


# ── Exportación CSV ─────────────────────────────────────────────────────────

def export_student_csv(student_id: int, token: str) -> bytes:
    data = build_student_report_data(student_id, token)
    student = data["student"]
    buf = io.StringIO()
    w = csv.writer(buf)

    nombre = f"{student.get('nombre','')} {student.get('apellido','')}".strip() or f"Estudiante {student_id}"
    w.writerow(["INFORME ACADÉMICO — UCC"])
    w.writerow(["Estudiante", nombre])
    w.writerow(["Correo", student.get("email", "—")])
    w.writerow(["Cédula", student.get("document_id", "—")])
    w.writerow(["Fecha", date.today().strftime("%d/%m/%Y")])
    w.writerow([])
    w.writerow(["Curso", "Nota", "Estado"])
    for r in data["grades"]:
        w.writerow([r["course"], r["score"], r["passed"]])
    w.writerow([])
    w.writerow(["Promedio general", f"{data['average']:.2f}"])

    fin = data["financial"]
    if isinstance(fin, dict) and not fin.get("error"):
        w.writerow([])
        w.writerow(["RESUMEN FINANCIERO"])
        w.writerow(["Deuda total", fin.get("total_debt", "—")])
        w.writerow(["Total pagado", fin.get("total_paid", "—")])
        w.writerow(["Estado", fin.get("status", "—")])

    return buf.getvalue().encode("utf-8-sig")


def export_course_csv(course_id: int, token: str) -> bytes:
    data = build_course_report_data(course_id, token)
    buf = io.StringIO()
    w = csv.writer(buf)

    w.writerow(["INFORME DE CURSO — UCC"])
    w.writerow(["Curso", data["course_name"]])
    w.writerow(["Fecha", date.today().strftime("%d/%m/%Y")])
    w.writerow(["Total matriculados", data["total"]])
    w.writerow(["Aprobados", data["passed"]])
    w.writerow(["Reprobados", data["failed"]])
    w.writerow(["Promedio grupo", f"{data['average']:.2f}"])
    w.writerow([])
    w.writerow(["Estudiante", "Correo", "Nota", "Estado"])
    for r in data["grades"]:
        w.writerow([r["student"], r["email"], r["score"], r["passed"]])

    return buf.getvalue().encode("utf-8-sig")


# ── Exportación PDF ─────────────────────────────────────────────────────────

def _pdf_header_table(fields: list[tuple]) -> Table:
    """Tabla de dos columnas para encabezado de informe."""
    tdata = [[Paragraph(f"<b>{k}</b>", getSampleStyleSheet()["Normal"]),
              Paragraph(str(v), getSampleStyleSheet()["Normal"])] for k, v in fields]
    t = Table(tdata, colWidths=[4 * cm, 12 * cm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), LIGHT_BG),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, LIGHT_BG]),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.lightgrey),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.lightgrey),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


def _grade_color(score_str: str) -> colors.HexColor:
    try:
        v = float(score_str)
        return SUCCESS if v >= 3.0 else DANGER
    except Exception:
        return colors.grey


def export_student_pdf(student_id: int, token: str) -> bytes:
    data = build_student_report_data(student_id, token)
    student = data["student"]
    nombre = f"{student.get('nombre','')} {student.get('apellido','')}".strip() or f"Estudiante {student_id}"

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
                            leftMargin=2 * cm, rightMargin=2 * cm,
                            topMargin=2 * cm, bottomMargin=2 * cm)
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("title", parent=styles["Title"],
                                 textColor=PRIMARY, fontSize=18, spaceAfter=6)
    subtitle_style = ParagraphStyle("subtitle", parent=styles["Normal"],
                                    textColor=colors.grey, fontSize=10, spaceAfter=12)
    section_style = ParagraphStyle("section", parent=styles["Heading2"],
                                   textColor=PRIMARY, fontSize=12, spaceBefore=14, spaceAfter=6)

    story = [
        Paragraph("Universidad Cooperativa de Colombia", title_style),
        Paragraph(f"Informe Académico del Estudiante — {date.today().strftime('%d/%m/%Y')}", subtitle_style),
        _pdf_header_table([
            ("Nombre", nombre),
            ("Correo", student.get("email", "—")),
            ("Cédula", student.get("document_id", "—")),
        ]),
        Spacer(1, 0.5 * cm),
        Paragraph("Calificaciones por materia", section_style),
    ]

    grade_headers = [["Materia", "Nota", "Estado"]]
    grade_rows = [[r["course"], r["score"], r["passed"]] for r in data["grades"]] or [["Sin registros", "", ""]]
    grade_data = grade_headers + grade_rows

    grade_style = TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT_BG]),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.lightgrey),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.lightgrey),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("ALIGN", (1, 1), (1, -1), "CENTER"),
        ("ALIGN", (2, 1), (2, -1), "CENTER"),
    ])
    for i, r in enumerate(data["grades"], start=1):
        c = _grade_color(r["score"])
        grade_style.add("TEXTCOLOR", (1, i), (1, i), c)
        grade_style.add("FONTNAME", (1, i), (1, i), "Helvetica-Bold")

    gt = Table(grade_data, colWidths=[11 * cm, 2.5 * cm, 3 * cm])
    gt.setStyle(grade_style)
    story.append(gt)

    story.append(Spacer(1, 0.3 * cm))
    story.append(Paragraph(f"<b>Promedio general: {data['average']:.2f}</b>",
                            ParagraphStyle("avg", parent=styles["Normal"], fontSize=11,
                                           textColor=PRIMARY if data["average"] >= 3.0 else DANGER)))

    fin = data["financial"]
    if isinstance(fin, dict) and not fin.get("error"):
        story.append(Paragraph("Resumen Financiero", section_style))
        story.append(_pdf_header_table([
            ("Deuda total", f"$ {fin.get('total_debt', '—')}"),
            ("Total pagado", f"$ {fin.get('total_paid', '—')}"),
            ("Estado", fin.get("status", "—")),
        ]))

    doc.build(story)
    return buf.getvalue()


def export_course_pdf(course_id: int, token: str) -> bytes:
    data = build_course_report_data(course_id, token)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
                            leftMargin=2 * cm, rightMargin=2 * cm,
                            topMargin=2 * cm, bottomMargin=2 * cm)
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("title", parent=styles["Title"],
                                 textColor=PRIMARY, fontSize=18, spaceAfter=6)
    subtitle_style = ParagraphStyle("subtitle", parent=styles["Normal"],
                                    textColor=colors.grey, fontSize=10, spaceAfter=12)
    section_style = ParagraphStyle("section", parent=styles["Heading2"],
                                   textColor=PRIMARY, fontSize=12, spaceBefore=14, spaceAfter=6)

    story = [
        Paragraph("Universidad Cooperativa de Colombia", title_style),
        Paragraph(f"Informe de Curso — {date.today().strftime('%d/%m/%Y')}", subtitle_style),
        _pdf_header_table([
            ("Curso", data["course_name"]),
            ("Total matriculados", str(data["total"])),
            ("Aprobados", str(data["passed"])),
            ("Reprobados", str(data["failed"])),
            ("Promedio grupo", f"{data['average']:.2f}"),
        ]),
        Spacer(1, 0.5 * cm),
        Paragraph("Calificaciones individuales", section_style),
    ]

    headers = [["Estudiante", "Correo", "Nota", "Estado"]]
    rows = [[r["student"], r["email"], r["score"], r["passed"]] for r in data["grades"]] or [["Sin registros", "", "", ""]]
    tdata = headers + rows

    ts = TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT_BG]),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.lightgrey),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.lightgrey),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("ALIGN", (2, 1), (2, -1), "CENTER"),
        ("ALIGN", (3, 1), (3, -1), "CENTER"),
    ])
    for i, r in enumerate(data["grades"], start=1):
        c = _grade_color(r["score"])
        ts.add("TEXTCOLOR", (2, i), (2, i), c)
        ts.add("FONTNAME", (2, i), (2, i), "Helvetica-Bold")

    t = Table(tdata, colWidths=[6 * cm, 5.5 * cm, 2.5 * cm, 2.5 * cm])
    t.setStyle(ts)
    story.append(t)
    doc.build(story)
    return buf.getvalue()