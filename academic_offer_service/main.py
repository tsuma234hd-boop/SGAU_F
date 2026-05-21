from fastapi import FastAPI, Depends, HTTPException
from fastapi.responses import HTMLResponse
from prometheus_fastapi_instrumentator import Instrumentator
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
import models, schemas, crud
from database import engine, get_db
from auth import get_current_user, require_roles

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Academic Offer Service")
Instrumentator().instrument(app).expose(app, include_in_schema=False)

# ── Asegurar esquema de Teacher si la tabla ya existe ──
from sqlalchemy import inspect, text


def course_def(
    code: str,
    name: str,
    credits: int,
    prerequisites: list[str] | None = None,
    dia: str = "Por definir",
    hora_inicio: str = "00:00",
    hora_fin: str = "00:00",
    aula: str = "Por definir",
):
    return {
        "code": code,
        "name": name,
        "credits": credits,
        "prerequisites": prerequisites or [],
        "dia": dia,
        "hora_inicio": hora_inicio,
        "hora_fin": hora_fin,
        "aula": aula,
    }


# ---------------------------------------------------------------------------
# Helpers para generar horarios sin conflictos
# idx 0-4 → lun-vie turno mañana  |  idx 5-9 → lun-vie turno tarde
# Salón: Aula (career_base + (sem-1)*2 + turno + 1)
#   DER → career_base=200 (Aula 201-218)
#   ISIS → career_base=300 (Aula 301-318)  [usado en seed_isis si se migra]
#   ADM → career_base=400 (Aula 401-418)
# ---------------------------------------------------------------------------
_DIAS = ["lunes", "martes", "miercoles", "jueves", "viernes"]

_BANDAS = {   # turno mañana
    1: ("07:00", "09:00"), 2: ("09:00", "11:00"), 3: ("11:00", "13:00"),
    4: ("07:00", "09:00"), 5: ("09:00", "11:00"), 6: ("11:00", "13:00"),
    7: ("07:00", "09:00"), 8: ("09:00", "11:00"), 9: ("08:00", "13:00"),
}
_BANDAS2 = {  # turno tarde (diferente al de mañana para mismo sem)
    1: ("14:00", "16:00"), 2: ("16:00", "18:00"), 3: ("14:00", "16:00"),
    4: ("16:00", "18:00"), 5: ("14:00", "16:00"), 6: ("16:00", "18:00"),
    7: ("14:00", "16:00"), 8: ("16:00", "18:00"), 9: ("14:00", "17:00"),
}

def cd(sem: int, idx: int, code: str, name: str, credits: int,
       prereqs: list | None = None, career_base: int = 200) -> dict:
    """course_def con horario y salón sin conflictos dentro de la carrera."""
    day = _DIAS[idx % 5]
    morning = idx < 5
    hi, hf = _BANDAS[sem] if morning else _BANDAS2[sem]
    if credits == 1:
        hf = str(int(hi[:2]) + 1).zfill(2) + ":00"
    aula_num = career_base + (sem - 1) * 2 + (0 if morning else 1) + 1
    return course_def(code, name, credits, prereqs, day, hi, hf, f"Aula {aula_num}")


def sync_career_courses_by_semester(
    career_code: str,
    career_name: str,
    career_description: str,
    courses_by_semester: dict[int, list[dict[str, object]]],
    faculty: str | None = None,
    duration_semesters: int | None = None,
    modality: str | None = None,
    degree_title: str | None = None,
):
    with Session(engine) as db:
        career = db.query(models.Career).filter(models.Career.code == career_code).first()
        if not career:
            career = models.Career(
                code=career_code,
                name=career_name,
                description=career_description,
                faculty=faculty,
                duration_semesters=duration_semesters,
                modality=modality,
                degree_title=degree_title,
            )
            db.add(career)
            db.commit()
            db.refresh(career)
        else:
            career.name = career_name
            career.description = career_description
            if faculty: career.faculty = faculty
            if duration_semesters: career.duration_semesters = duration_semesters
            if modality: career.modality = modality
            if degree_title: career.degree_title = degree_title
            db.commit()

        existing_courses = {
            c.code: c for c in db.query(models.Course).filter(models.Course.career_id == career.id).all()
        }
        target_codes: set[str] = set()
        target_prerequisites: dict[str, list[str]] = {}

        for semester, items in courses_by_semester.items():
            for item in items:
                code = str(item["code"])
                name = str(item["name"])
                credits = int(item["credits"])
                target_codes.add(code)
                target_prerequisites[code] = [str(prereq) for prereq in item.get("prerequisites", [])]
                course = existing_courses.get(code)
                _dia   = item.get("dia", "Por definir")
                _hi    = item.get("hora_inicio", "00:00")
                _hf    = item.get("hora_fin", "00:00")
                _aula  = item.get("aula", "Por definir")
                _sched = f"{_dia} {_hi}-{_hf}" if _dia != "Por definir" else "Por definir"

                if course:
                    course.name = name
                    course.credits = credits
                    course.semester = semester
                    course.career_id = career.id
                    # Sobreescribir siempre para que el seed sea fuente de verdad
                    course.day_of_week = _dia
                    course.start_time = _hi
                    course.end_time = _hf
                    course.location = _aula
                    course.schedule = _sched
                    continue

                course = models.Course(
                    code=code,
                    name=name,
                    credits=credits,
                    semester=semester,
                    career_id=career.id,
                    day_of_week=_dia,
                    start_time=_hi,
                    end_time=_hf,
                    location=_aula,
                    schedule=_sched,
                )
                db.add(course)
                existing_courses[code] = course

        db.flush()

        for code, prerequisite_codes in target_prerequisites.items():
            course = existing_courses[code]
            course.prerequisites = [existing_courses[prereq_code] for prereq_code in prerequisite_codes if prereq_code in existing_courses]

        stale_courses = [course for code, course in existing_courses.items() if code not in target_codes]
        for course in stale_courses:
            db.execute(text("DELETE FROM prerequisites WHERE course_id = :course_id OR prerequisite_id = :course_id"), {"course_id": course.id})
            db.execute(text("DELETE FROM assignments WHERE course_id = :course_id"), {"course_id": course.id})
            db.delete(course)

        db.commit()

def ensure_teacher_schema():
    inspector = inspect(engine)
    if "teachers" in inspector.get_table_names():
        columns = [col["name"] for col in inspector.get_columns("teachers")]
        with engine.connect() as conn:
            if "user_id" not in columns:
                conn.execute(text("ALTER TABLE teachers ADD COLUMN IF NOT EXISTS user_id INTEGER"))
            if "email" not in columns:
                conn.execute(text("ALTER TABLE teachers ADD COLUMN IF NOT EXISTS email VARCHAR(150)"))
            if "first_name" not in columns:
                conn.execute(text("ALTER TABLE teachers ADD COLUMN IF NOT EXISTS first_name VARCHAR(100)"))
            if "last_name" not in columns:
                conn.execute(text("ALTER TABLE teachers ADD COLUMN IF NOT EXISTS last_name VARCHAR(100)"))
            if "document_id" not in columns:
                conn.execute(text("ALTER TABLE teachers ADD COLUMN IF NOT EXISTS document_id VARCHAR(50)"))
            if "name" not in columns:
                conn.execute(text("ALTER TABLE teachers ADD COLUMN IF NOT EXISTS name VARCHAR(255)"))
            if "career_code" not in columns:
                conn.execute(text("ALTER TABLE teachers ADD COLUMN IF NOT EXISTS career_code VARCHAR(50)"))
            conn.commit()


def ensure_course_schema():
    inspector = inspect(engine)
    if "courses" in inspector.get_table_names():
        columns = [col["name"] for col in inspector.get_columns("courses")]
        with engine.connect() as conn:
            if "career_id" not in columns:
                conn.execute(text("ALTER TABLE courses ADD COLUMN IF NOT EXISTS career_id INTEGER"))
            if "day_of_week" not in columns:
                conn.execute(text("ALTER TABLE courses ADD COLUMN IF NOT EXISTS day_of_week VARCHAR(50)"))
            if "start_time" not in columns:
                conn.execute(text("ALTER TABLE courses ADD COLUMN IF NOT EXISTS start_time VARCHAR(20)"))
            if "end_time" not in columns:
                conn.execute(text("ALTER TABLE courses ADD COLUMN IF NOT EXISTS end_time VARCHAR(20)"))
            if "location" not in columns:
                conn.execute(text("ALTER TABLE courses ADD COLUMN IF NOT EXISTS location VARCHAR(255)"))
            if "semester" not in columns:
                conn.execute(text("ALTER TABLE courses ADD COLUMN IF NOT EXISTS semester INTEGER"))
            if "max_students" not in columns:
                conn.execute(text("ALTER TABLE courses ADD COLUMN IF NOT EXISTS max_students INTEGER"))
            conn.commit()


def ensure_course_session_schema():
    inspector = inspect(engine)
    if "course_sessions" in inspector.get_table_names():
        columns = [col["name"] for col in inspector.get_columns("course_sessions")]
        with engine.connect() as conn:
            if "teacher_id" not in columns:
                conn.execute(text("ALTER TABLE course_sessions ADD COLUMN IF NOT EXISTS teacher_id INTEGER"))
            conn.commit()


def ensure_career_schema():
    inspector = inspect(engine)
    if "careers" not in inspector.get_table_names():
        with engine.connect() as conn:
            conn.execute(text(
                "CREATE TABLE IF NOT EXISTS careers ("
                "id SERIAL PRIMARY KEY, "
                "code VARCHAR(100) UNIQUE, "
                "name VARCHAR(255), "
                "description VARCHAR(500)"
                ")"
            ))
            conn.commit()
    # Agregar columnas nuevas si no existen
    columns = [col["name"] for col in inspect(engine).get_columns("careers")]
    with engine.connect() as conn:
        if "faculty" not in columns:
            conn.execute(text("ALTER TABLE careers ADD COLUMN IF NOT EXISTS faculty VARCHAR(255)"))
        if "duration_semesters" not in columns:
            conn.execute(text("ALTER TABLE careers ADD COLUMN IF NOT EXISTS duration_semesters INTEGER"))
        if "modality" not in columns:
            conn.execute(text("ALTER TABLE careers ADD COLUMN IF NOT EXISTS modality VARCHAR(100)"))
        if "degree_title" not in columns:
            conn.execute(text("ALTER TABLE careers ADD COLUMN IF NOT EXISTS degree_title VARCHAR(255)"))
        if "credit_cost" not in columns:
            conn.execute(text("ALTER TABLE careers ADD COLUMN IF NOT EXISTS credit_cost NUMERIC(10, 2) DEFAULT 145000"))
        conn.commit()

ensure_teacher_schema()
ensure_career_schema()
ensure_course_schema()
ensure_course_session_schema()

def seed_adm_courses_by_semester():
    adm_courses = {
        1: [
            cd(1, 0, "ADM-101", "Fundamentos de contabilidad",          3, career_base=400),
            cd(1, 1, "ADM-102", "Fundamentos de la administración",      3, career_base=400),
            cd(1, 2, "ADM-103", "Matemáticas fundamentales",             3, career_base=400),
            cd(1, 3, "ADM-104", "Fundamentos de la economía",            3, career_base=400),
            cd(1, 4, "ADM-105", "Fundamentos de mercadeo",               3, career_base=400),
        ],
        2: [
            cd(2, 0, "ADM-201", "Responsabilidad social corporativa",    3, career_base=400),
            cd(2, 1, "ADM-202", "Calculo 1",                             3, ["ADM-103"], career_base=400),
            cd(2, 2, "ADM-203", "Teorías de la administración",          3, ["ADM-102"], career_base=400),
            cd(2, 3, "ADM-204", "Psicología y comunicación organizacional", 3, career_base=400),
            cd(2, 4, "ADM-205", "Costos 0",                              3, ["ADM-101"], career_base=400),
        ],
        3: [
            cd(3, 0, "ADM-301", "Ingles 1",                              3, career_base=400),
            cd(3, 1, "ADM-302", "Probabilidad y estadística",            3, ["ADM-202"], career_base=400),
            cd(3, 2, "ADM-303", "Microeconomía",                         3, ["ADM-104"], career_base=400),
            cd(3, 3, "ADM-304", "Procesos de administración",            3, ["ADM-203"], career_base=400),
            cd(3, 4, "ADM-305", "Investigación de operaciones",          3, ["ADM-202"], career_base=400),
            cd(3, 5, "ADM-306", "Investigación de mercados",             3, ["ADM-105"], career_base=400),
        ],
        4: [
            cd(4, 0, "ADM-401", "Ingles 2",                              3, ["ADM-301"], career_base=400),
            cd(4, 1, "ADM-402", "Matemática financiera",                 3, ["ADM-202"], career_base=400),
            cd(4, 2, "ADM-403", "Legislación empresarial",               3, career_base=400),
            cd(4, 3, "ADM-404", "Macroeconomía",                         3, ["ADM-303"], career_base=400),
            cd(4, 4, "ADM-405", "Estadística aplicada",                  3, ["ADM-302"], career_base=400),
            cd(4, 5, "ADM-406", "Plan estratégico de mercadeo",          3, ["ADM-306"], career_base=400),
        ],
        5: [
            cd(5, 0, "ADM-501", "Ingles 3",                              3, ["ADM-401"], career_base=400),
            cd(5, 1, "ADM-502", "Administración financiera",             3, ["ADM-402"], career_base=400),
            cd(5, 2, "ADM-503", "Emprendimiento y creatividad",          3, career_base=400),
            cd(5, 3, "ADM-504", "Presupuesto",                           3, ["ADM-205", "ADM-402"], career_base=400),
            cd(5, 4, "ADM-505", "Gestión del talento humano",            3, ["ADM-304"], career_base=400),
            cd(5, 5, "ADM-506", "Gestión de la calidad y la producción", 3, ["ADM-304"], career_base=400),
        ],
        6: [
            cd(6, 0, "ADM-601", "Ingles 4",                              3, ["ADM-501"], career_base=400),
            cd(6, 1, "ADM-602", "Razonamiento cuantitativo",             3, ["ADM-305"], career_base=400),
            cd(6, 2, "ADM-603", "Constitución política",                 2, career_base=400),
            cd(6, 3, "ADM-604", "Formulación y evaluación de proyectos", 3, ["ADM-503", "ADM-305"], career_base=400),
            cd(6, 4, "ADM-605", "Administración financiera 2",           2, ["ADM-502"], career_base=400),
            cd(6, 5, "ADM-606", "Derecho tributario",                    3, ["ADM-403"], career_base=400),
        ],
        7: [
            cd(7, 0, "ADM-701", "Gerencia de proyectos",                 3, ["ADM-604"], career_base=400),
            cd(7, 1, "ADM-702", "Administración publica",                3, ["ADM-304"], career_base=400),
            cd(7, 2, "ADM-703", "Procesos de simulación gerencial",      3, ["ADM-602"], career_base=400),
            cd(7, 3, "ADM-704", "Creación empresarial",                  3, ["ADM-503"], career_base=400),
            cd(7, 4, "ADM-705", "Modelos de desarrollo económico",       3, ["ADM-404"], career_base=400),
            cd(7, 5, "ADM-706", "Gestión de la distribución",            3, ["ADM-406"], career_base=400),
        ],
        8: [
            cd(8, 0, "ADM-801", "Gerencia estratégica",                  3, ["ADM-701", "ADM-705"], career_base=400),
            cd(8, 1, "ADM-802", "Trabajo de grado 1",                    3, ["ADM-701"], career_base=400),
            cd(8, 2, "ADM-803", "Innovación empresarial",                3, ["ADM-704"], career_base=400),
            cd(8, 3, "ADM-804", "Comercio exterior",                     3, ["ADM-706"], career_base=400),
            cd(8, 4, "ADM-805", "Electiva de profundización 1",          3, career_base=400),
        ],
        9: [
            cd(9, 0, "ADM-901", "Práctica empresarial",                  3, ["ADM-801"], career_base=400),
            cd(9, 1, "ADM-902", "Trabajo de grado 2",                    3, ["ADM-802"], career_base=400),
            cd(9, 2, "ADM-903", "Electiva de profundización 2",          3, ["ADM-805"], career_base=400),
        ],
    }
    sync_career_courses_by_semester(
        "ADM",
        "Administración de Empresas",
        "Programa de administración empresarial",
        adm_courses,
        faculty="Facultad de Ciencias Económicas, Administrativas y Contables",
        duration_semesters=9,
        modality="Presencial",
        degree_title="Administrador de Empresas",
    )


def seed_der_courses_by_semester():
    """Derecho - Universidad del Sinú Elías Bechara Zainúm."""
    # Eliminar ISC si existe (reemplazada por DER)
    with Session(engine) as db:
        isc = db.query(models.Career).filter(models.Career.code == "ISC").first()
        if isc:
            courses = db.query(models.Course).filter(models.Course.career_id == isc.id).all()
            for course in courses:
                db.execute(text("DELETE FROM prerequisites WHERE course_id = :id OR prerequisite_id = :id"), {"id": course.id})
                db.execute(text("DELETE FROM assignments WHERE course_id = :id"), {"id": course.id})
                db.delete(course)
            db.delete(isc)
            db.commit()

    der_courses = {
        1: [
            cd(1, 0, "DER-101", "Pensamiento Matemático",                       1),
            cd(1, 1, "DER-102", "Teoría General del Estado",                    3),
            cd(1, 2, "DER-103", "Teatro y Derecho I",                           3),
            cd(1, 3, "DER-104", "Antropología Jurídica",                        2),
            cd(1, 4, "DER-105", "Sociología Jurídica",                          2),
            cd(1, 5, "DER-106", "Sociedad y Conflicto",                         2),
            cd(1, 6, "DER-107", "Teoría General del Derecho",                   5),
            cd(1, 7, "DER-108", "Pensamiento Unisinú / Cátedra Elías Bechara", 1),
        ],
        2: [
            cd(2, 0, "DER-201", "Filosofía",                        1),
            cd(2, 1, "DER-202", "Pensamiento y Lenguaje",           1),
            cd(2, 2, "DER-203", "Optativa I",                       1),
            cd(2, 3, "DER-204", "Fundamentos de Investigación",     3),
            cd(2, 4, "DER-205", "Teatro y Derecho II",              3, ["DER-103"]),
            cd(2, 5, "DER-206", "Derecho Constitucional",           5),
            cd(2, 6, "DER-207", "Personas",                         3),
            cd(2, 7, "DER-208", "Lógica y Razonamiento Jurídico",   2),
        ],
        3: [
            cd(3, 0, "DER-301", "Optativa II",                              1),
            cd(3, 1, "DER-302", "Filosofía del Derecho",                    2),
            cd(3, 2, "DER-303", "Técnica de Oralidad",                      3),
            cd(3, 3, "DER-304", "Fundamentos Económicos",                   2),
            cd(3, 4, "DER-305", "Bienes",                                   3),
            cd(3, 5, "DER-306", "Dirección y Planeación Estratégica",       2),
            cd(3, 6, "DER-307", "Argumentación y Hermenéutica Jurídica",    2),
            cd(3, 7, "DER-308", "Investigación Jurídica",                   2, ["DER-204"]),
            cd(3, 8, "DER-309", "Seminario I",                              1),
        ],
        4: [
            cd(4, 0, "DER-401", "Liderazgo y Productividad",   1),
            cd(4, 1, "DER-402", "Optativa III",                 1),
            cd(4, 2, "DER-403", "Bioderecho",                   2),
            cd(4, 3, "DER-404", "Sociedad y Familia",           2),
            cd(4, 4, "DER-405", "Obligaciones",                 5, ["DER-207"]),
            cd(4, 5, "DER-406", "Penal General",                3),
            cd(4, 6, "DER-407", "Gestión del Conflicto",        2),
            cd(4, 7, "DER-408", "Debido Proceso",               2, ["DER-206"]),
            cd(4, 8, "DER-409", "Seminario II",                 1, ["DER-309"]),
        ],
        5: [
            cd(5, 0, "DER-501", "Ecología y Medio Ambiente",       1),
            cd(5, 1, "DER-502", "Familia",                         3, ["DER-404"]),
            cd(5, 2, "DER-503", "Contratos",                       4, ["DER-405"]),
            cd(5, 3, "DER-504", "Penal Especial",                  2, ["DER-406"]),
            cd(5, 4, "DER-505", "M.A.S.C",                         2),
            cd(5, 5, "DER-506", "Procesal General",                2, ["DER-408"]),
            cd(5, 6, "DER-507", "Derecho Económico",               2),
            cd(5, 7, "DER-508", "Investigación Socio Jurídica",    2, ["DER-308"]),
            cd(5, 8, "DER-509", "Biopolítica",                     1),
            cd(5, 9, "DER-510", "Seminario III",                   1, ["DER-409"]),
        ],
        6: [
            cd(6, 0, "DER-601", "Sucesiones",                          2, ["DER-502"]),
            cd(6, 1, "DER-602", "Técnica de Negociación",              2),
            cd(6, 2, "DER-603", "Derecho Administrativo",              4),
            cd(6, 3, "DER-604", "Procesal Especial",                   3, ["DER-506"]),
            cd(6, 4, "DER-605", "Derecho Integracional",               2),
            cd(6, 5, "DER-606", "Diseño y Formulación de Proyectos",   1),
            cd(6, 6, "DER-607", "Electiva I",                          5),
        ],
        7: [
            cd(7, 0, "DER-701", "Derecho Comercial y Sociedades",                              3),
            cd(7, 1, "DER-702", "Responsabilidad Contractual y Extracontractual",              2, ["DER-503"]),
            cd(7, 2, "DER-703", "Relaciones Individuales del Trabajo y Conflictos Colectivos", 3),
            cd(7, 3, "DER-704", "Consultorio Jurídico y Conciliación I",                       5, ["DER-604"]),
            cd(7, 4, "DER-705", "Electiva II",                                                 6),
        ],
        8: [
            cd(8, 0, "DER-801", "Títulos Valores",                      2, ["DER-701"]),
            cd(8, 1, "DER-802", "Seguridad Social",                     2, ["DER-703"]),
            cd(8, 2, "DER-803", "Derecho Probatorio",                   2),
            cd(8, 3, "DER-804", "Biopoder",                             1),
            cd(8, 4, "DER-805", "Consultorio Jurídico y Conciliación II", 5, ["DER-704"]),
            cd(8, 5, "DER-806", "Electiva III",                         6),
        ],
        9: [
            cd(9, 0, "DER-901", "Práctica Profesional",  17),
        ],
    }
    sync_career_courses_by_semester(
        "DER",
        "Derecho",
        "Programa de Derecho",
        der_courses,
        faculty="Facultad de Derecho y Ciencias Políticas",
        duration_semesters=9,
        modality="Presencial",
        degree_title="Abogado",
    )

def seed_isis_courses_by_semester():
    """Ingeniería de Sistemas - Universidad del Sinú Elías Bechara Zainúm."""
    isis_courses = {
        1: [
            course_def("ISIS-101", "Introducción a la Ingeniería de Sistemas", 3,  None, "lunes",     "07:00", "09:00", "Aula 101"),
            course_def("ISIS-102", "Programación I",                           4,  None, "martes",    "07:00", "09:00", "Lab. Cómputo 1"),
            course_def("ISIS-103", "Cálculo Diferencial",                      4,  None, "miercoles", "07:00", "09:00", "Aula 102"),
            course_def("ISIS-104", "Álgebra y Geometría Analítica",            3,  None, "jueves",    "07:00", "09:00", "Aula 103"),
            course_def("ISIS-105", "Cátedra Elías Bechara Zainúm",            1,  None, "viernes",   "07:00", "08:00", "Aula 104"),
            course_def("ISIS-106", "Currículo Común Unisinú 1",               1,  None, "sabado",    "07:00", "08:00", "Aula 105"),
        ],
        2: [
            course_def("ISIS-201", "Programación II",              4,  ["ISIS-102"], "lunes",     "09:00", "11:00", "Lab. Cómputo 1"),
            course_def("ISIS-202", "Física I y Laboratorio",       4,  None,         "martes",    "09:00", "11:00", "Lab. Física"),
            course_def("ISIS-203", "Cálculo Integral",             4,  ["ISIS-103"], "miercoles", "09:00", "11:00", "Aula 106"),
            course_def("ISIS-204", "Currículo Común Unisinú 2",   1,  None,         "jueves",    "09:00", "10:00", "Aula 107"),
            course_def("ISIS-205", "Currículo Común Unisinú 3",   1,  None,         "viernes",   "09:00", "10:00", "Aula 108"),
            course_def("ISIS-206", "Currículo Común Unisinú 4",   1,  None,         "sabado",    "09:00", "10:00", "Aula 109"),
        ],
        3: [
            course_def("ISIS-301", "Estructuras de Datos",        4,  ["ISIS-201"],               "lunes",     "11:00", "13:00", "Lab. Cómputo 2"),
            course_def("ISIS-302", "Electrónica",                 4,  ["ISIS-202"],               "martes",    "11:00", "13:00", "Lab. Electrónica"),
            course_def("ISIS-303", "Cálculo Vectorial",           4,  ["ISIS-203"],               "miercoles", "11:00", "13:00", "Aula 201"),
            course_def("ISIS-304", "Probabilidad y Estadística",  4,  None,                       "jueves",    "11:00", "13:00", "Aula 202"),
            course_def("ISIS-305", "Currículo Común Unisinú 5",  1,  None,                       "viernes",   "11:00", "12:00", "Aula 203"),
            course_def("ISIS-306", "Ética General",               1,  None,                       "sabado",    "11:00", "12:00", "Aula 204"),
        ],
        4: [
            course_def("ISIS-401", "Análisis de Algoritmos",                      4,  ["ISIS-301"],               "lunes",     "14:00", "16:00", "Lab. Cómputo 1"),
            course_def("ISIS-402", "Circuitos Digitales",                          4,  ["ISIS-302"],               "martes",    "14:00", "16:00", "Lab. Electrónica"),
            course_def("ISIS-403", "Base de Datos",                               4,  ["ISIS-301"],               "miercoles", "14:00", "16:00", "Lab. Cómputo 2"),
            course_def("ISIS-404", "Ecuaciones Diferenciales",                    3,  ["ISIS-303"],               "jueves",    "14:00", "16:00", "Aula 205"),
            course_def("ISIS-405", "Currículo Común Unisinú 6 - Dicción y Oratoria", 1, None,                    "viernes",   "14:00", "15:00", "Aula 206"),
        ],
        5: [
            course_def("ISIS-501", "Administración de Bases De Datos", 4,  ["ISIS-403"],               "lunes",     "16:00", "18:00", "Lab. Cómputo 2"),
            course_def("ISIS-502", "Computación Móvil",                4,  ["ISIS-201"],               "martes",    "16:00", "18:00", "Lab. Cómputo 1"),
            course_def("ISIS-503", "Arquitectura del Computador",      4,  ["ISIS-402"],               "miercoles", "16:00", "18:00", "Aula 207"),
            course_def("ISIS-504", "Robótica y Laboratorio",           4,  ["ISIS-302"],               "jueves",    "16:00", "18:00", "Lab. Robótica"),
            course_def("ISIS-505", "Seminario de Investigación I",     2,  ["ISIS-304"],               "viernes",   "16:00", "18:00", "Aula 208"),
        ],
        6: [
            course_def("ISIS-601", "Sistemas Operativos",              4,  ["ISIS-503"],               "lunes",     "07:00", "09:00", "Lab. Cómputo 2"),
            course_def("ISIS-602", "Sistemas de Información y Gestión",4,  ["ISIS-501"],               "martes",    "07:00", "09:00", "Aula 301"),
            course_def("ISIS-603", "Telemática",                       4,  ["ISIS-503"],               "miercoles", "07:00", "09:00", "Lab. Redes"),
            course_def("ISIS-604", "Seminario de Investigación II",    2,  ["ISIS-505"],               "jueves",    "07:00", "09:00", "Aula 302"),
            course_def("ISIS-605", "Electiva Complementaria I",        3,  None,                       "viernes",   "07:00", "09:00", "Aula 303"),
        ],
        7: [
            course_def("ISIS-701", "Auditoría de Sistemas",      3,  ["ISIS-602"],               "lunes",     "09:00", "11:00", "Aula 304"),
            course_def("ISIS-702", "Electiva Complementaria II", 3,  None,                       "martes",    "09:00", "11:00", "Aula 305"),
            course_def("ISIS-703", "Ingeniería de Software",     4,  ["ISIS-401", "ISIS-403"],   "miercoles", "09:00", "11:00", "Lab. Cómputo 1"),
            course_def("ISIS-704", "Redes de Datos",             4,  ["ISIS-603"],               "jueves",    "09:00", "11:00", "Lab. Redes"),
            course_def("ISIS-705", "Sistemas de Tiempo Real",    4,  ["ISIS-601"],               "viernes",   "09:00", "11:00", "Lab. Cómputo 2"),
        ],
        8: [
            course_def("ISIS-801", "Computación Gráfica",                           4,  ["ISIS-503"],               "lunes",     "14:00", "16:00", "Lab. Cómputo 1"),
            course_def("ISIS-802", "Programación Web I",                            4,  ["ISIS-703"],               "martes",    "14:00", "16:00", "Lab. Cómputo 2"),
            course_def("ISIS-803", "Ética Profesional",                             1,  None,                       "miercoles", "14:00", "15:00", "Aula 401"),
            course_def("ISIS-804", "Tecnología Informática en las Organizaciones",  3,  ["ISIS-602"],               "jueves",    "14:00", "16:00", "Aula 402"),
            course_def("ISIS-805", "Legislación para Ingenieros",                   2,  None,                       "viernes",   "14:00", "16:00", "Aula 403"),
            course_def("ISIS-806", "Administración y Mantenimiento de Redes",       4,  ["ISIS-704"],               "sabado",    "14:00", "16:00", "Lab. Redes"),
        ],
        9: [
            course_def("ISIS-901", "Electiva Profesional I",   3,  None,                       "lunes",     "18:00", "20:00", "Aula 404"),
            course_def("ISIS-902", "Electiva Profesional II",  3,  ["ISIS-901"],               "martes",    "18:00", "20:00", "Aula 405"),
            course_def("ISIS-903", "Electiva Profesional III", 3,  ["ISIS-901"],               "miercoles", "18:00", "20:00", "Aula 406"),
            course_def("ISIS-904", "Práctica Empresarial",     5,  None,                       "jueves",    "08:00", "13:00", "Externo"),
            course_def("ISIS-905", "Opción de Grado",          3,  ["ISIS-703", "ISIS-802"],   "viernes",   "18:00", "20:00", "Aula 407"),
        ],
    }

    # No hay clases sábado/domingo: remapear a lunes-viernes.
    # Si la franja ya está ocupada en los 5 días, mover a la banda de tarde del semestre.
    weekday_order = ["lunes", "martes", "miercoles", "jueves", "viernes"]

    def _norm_day(day: str) -> str:
        d = (day or "").strip().lower()
        mapping = {
            "miércoles": "miercoles",
            "sábado": "sabado",
            "domingo": "domingo",
        }
        return mapping.get(d, d)

    for sem, items in isis_courses.items():
        used = set()
        for item in items:
            used.add((_norm_day(str(item.get("dia", ""))), str(item.get("hora_inicio", "")), str(item.get("hora_fin", ""))))

        for item in items:
            day = _norm_day(str(item.get("dia", "")))
            if day not in ("sabado", "domingo"):
                continue

            hi = str(item.get("hora_inicio", "00:00"))
            hf = str(item.get("hora_fin", "00:00"))
            credits = int(item.get("credits", 2))

            target_day = None
            for d in weekday_order:
                if (d, hi, hf) not in used:
                    target_day = d
                    break

            if target_day is None:
                hi, hf = _BANDAS2[sem]
                if credits == 1:
                    hf = str(int(hi[:2]) + 1).zfill(2) + ":00"
                for d in weekday_order:
                    if (d, hi, hf) not in used:
                        target_day = d
                        break

            if target_day is None:
                target_day = "viernes"

            used.discard((day, str(item.get("hora_inicio", "")), str(item.get("hora_fin", ""))))
            item["dia"] = target_day
            item["hora_inicio"] = hi
            item["hora_fin"] = hf
            used.add((target_day, hi, hf))

    # Normalizar aulas de ISIS al bloque 300 por semestre/turno para evitar colisiones
    for sem, items in isis_courses.items():
        for item in items:
            if item.get("aula") == "Externo":
                continue
            hi = str(item.get("hora_inicio", "00:00"))
            start_hour = int(hi[:2]) if len(hi) >= 2 and hi[:2].isdigit() else 0
            is_afternoon = start_hour >= 14
            aula_num = 300 + (sem - 1) * 2 + (1 if is_afternoon else 0) + 1
            item["aula"] = f"Aula {aula_num}"

    sync_career_courses_by_semester(
        "ISIS",
        "Ingeniería de Sistemas",
        "Programa de Ingeniería de Sistemas",
        isis_courses,
        faculty="Facultad de Ingenierías",
        duration_semesters=9,
        modality="Presencial",
        degree_title="Ingeniero de Sistemas",
    )

seed_adm_courses_by_semester()
seed_der_courses_by_semester()
seed_isis_courses_by_semester()

# ── Home HTML ──
@app.get("/", response_class=HTMLResponse)
async def read_root():
    with open("index.html", "r", encoding="utf-8") as f:
        return f.read()

@app.get("/health")
def health():
    return {"status": "ok", "service": "academic"}

# ── API Routes ──
@app.get("/api/")
def api_root(user=Depends(get_current_user)):
    return {"message": "Academic Offer Service API"}


def _get_teacher_for_user(db: Session, user: dict) -> models.Teacher:
    teacher = crud.get_teacher_by_user_id(db, user.get("user_id"))
    if not teacher:
        raise HTTPException(status_code=404, detail="Docente no encontrado")
    return teacher


def _teacher_assigned_course_ids(db: Session, teacher_id: int) -> set[int]:
    assignments = crud.get_assignments_by_teacher(db, teacher_id)
    return {assignment.course_id for assignment in assignments}

# ── Courses ──
# Redirigir a /api/courses/
@app.post("/api/courses/", response_model=schemas.Course)
def create_course_api(
    course: schemas.CourseCreate,
    user=Depends(require_roles(["admin"])),
    db: Session = Depends(get_db),
):
    try:
        return crud.create_course(db, course)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Ya existe un curso con ese código")

@app.get("/api/courses/", response_model=list[schemas.Course])
def read_courses_api(
    career_id: int | None = None,
    skip: int = 0,
    limit: int = 100,
    user=Depends(require_roles(["admin", "docente", "estudiante"])),
    db: Session = Depends(get_db),
):
    if user.get("role") != "docente":
        return crud.get_courses(db, skip, limit, career_id)

    teacher = _get_teacher_for_user(db, user)
    allowed_ids = _teacher_assigned_course_ids(db, teacher.id)
    courses = crud.get_courses(db, skip=0, limit=1000, career_id=career_id)
    scoped = [course for course in courses if course.id in allowed_ids]
    return scoped[skip: skip + limit]

@app.get("/api/courses/{course_id}", response_model=schemas.Course)
def read_course_api(
    course_id: int,
    user=Depends(require_roles(["admin", "docente", "estudiante"])),
    db: Session = Depends(get_db),
):
    course = crud.get_course(db, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Curso no encontrado")

    if user.get("role") == "docente":
        teacher = _get_teacher_for_user(db, user)
        if course.id not in _teacher_assigned_course_ids(db, teacher.id):
            raise HTTPException(status_code=403, detail="Solo puedes ver cursos asignados")

    return course

@app.put("/api/courses/{course_id}", response_model=schemas.Course)
def update_course_api(
    course_id: int,
    course_data: schemas.CourseUpdate,
    user=Depends(require_roles(["admin"])),
    db: Session = Depends(get_db),
):
    try:
        course = crud.update_course(db, course_id, course_data)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Conflicto al actualizar curso")

    if not course:
        raise HTTPException(status_code=404, detail="Curso no encontrado")
    return course

@app.delete("/api/courses/{course_id}")
def delete_course_api(
    course_id: int,
    user=Depends(require_roles(["admin"])),
    db: Session = Depends(get_db),
):
    course = crud.delete_course(db, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Curso no encontrado")
    return {"message": "Curso eliminado correctamente"}

# ── Careers ──
@app.post("/api/careers/", response_model=schemas.Career)
def create_career_api(
    career: schemas.CareerCreate,
    user=Depends(require_roles(["admin"])),
    db: Session = Depends(get_db),
):
    try:
        return crud.create_career(db, career)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Ya existe una carrera con ese código")

@app.get("/api/careers/", response_model=list[schemas.Career])
def read_careers_api(
    user=Depends(require_roles(["admin", "docente", "estudiante"])),
    db: Session = Depends(get_db),
):
    return crud.get_careers(db)

@app.get("/api/careers/{career_id}", response_model=schemas.Career)
def read_career_api(
    career_id: int,
    user=Depends(require_roles(["admin", "docente", "estudiante"])),
    db: Session = Depends(get_db),
):
    career = crud.get_career(db, career_id)
    if not career:
        raise HTTPException(status_code=404, detail="Carrera no encontrada")
    return career

@app.get("/api/careers/{career_id}/courses/semester/{semester}")
def read_courses_by_semester(
    career_id: int,
    semester: int,
    user=Depends(require_roles(["admin", "docente", "estudiante"])),
    db: Session = Depends(get_db),
):
    """Obtiene cursos de un semestre específico con sus prerequisitos"""
    career = crud.get_career(db, career_id)
    if not career:
        raise HTTPException(status_code=404, detail="Carrera no encontrada")
    
    courses = db.query(models.Course).filter(
        models.Course.career_id == career_id,
        models.Course.semester == semester
    ).order_by(models.Course.code).all()
    
    result = []
    for course in courses:
        course_dict = {
            "id": course.id,
            "code": course.code,
            "name": course.name,
            "credits": course.credits,
            "semester": course.semester,
            "prerequisite_codes": course.prerequisite_codes,
            "max_students": course.max_students,
        }
        result.append(course_dict)
    
    return result

# ── Teachers ──
@app.post("/api/teachers/", response_model=schemas.Teacher)
def create_teacher_api(
    teacher: schemas.TeacherCreate,
    user=Depends(require_roles(["admin"])),
    db: Session = Depends(get_db),
):
    try:
        return crud.create_teacher(db, teacher)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Ya existe un docente con ese user_id")

@app.get("/api/teachers/", response_model=list[schemas.Teacher])
def read_teachers_api(
    document_id: str | None = None,
    career_code: str | None = None,
    course_id: int | None = None,
    name: str | None = None,
    user=Depends(require_roles(["admin", "docente"])),
    db: Session = Depends(get_db),
):
    return crud.get_teachers(db, document_id=document_id, career_code=career_code, course_id=course_id, name=name)

@app.get("/api/teachers/{teacher_id}", response_model=schemas.Teacher)
def read_teacher_api(
    teacher_id: int,
    user=Depends(require_roles(["admin", "docente", "estudiante"])),
    db: Session = Depends(get_db),
):
    teacher = crud.get_teacher(db, teacher_id)
    if not teacher:
        raise HTTPException(status_code=404, detail="Docente no encontrado")

    if user.get("role") == "docente" and teacher.user_id != user.get("user_id"):
        raise HTTPException(status_code=403, detail="Solo puedes ver tu perfil docente")

    return teacher

@app.get("/api/teachers/user/{user_id}", response_model=schemas.Teacher)
def read_teacher_by_user_api(
    user_id: int,
    user=Depends(require_roles(["admin", "docente"])),
    db: Session = Depends(get_db),
):
    if user.get("role") == "docente" and user_id != user.get("user_id"):
        raise HTTPException(status_code=403, detail="Solo puedes consultar tu usuario docente")

    teacher = crud.get_teacher_by_user_id(db, user_id)
    if not teacher:
        raise HTTPException(status_code=404, detail="Docente no encontrado")
    return teacher


@app.put("/api/teachers/{teacher_id}", response_model=schemas.Teacher)
def update_teacher_api(
    teacher_id: int,
    teacher: schemas.TeacherUpdate,
    user=Depends(require_roles(["admin"])),
    db: Session = Depends(get_db),
):
    try:
        updated = crud.update_teacher(db, teacher_id, teacher)
        if not updated:
            raise HTTPException(status_code=404, detail="Docente no encontrado")
        return updated
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Conflicto al actualizar docente")

# ── Assignments ──
@app.post("/api/assignments/")
def assign_teacher_api(
    assignment: schemas.AssignmentCreate,
    user=Depends(require_roles(["admin"])),
    db: Session = Depends(get_db),
):
    return crud.assign_teacher(db, assignment)

@app.get("/api/assignments/")
def read_assignments_api(user=Depends(require_roles(["admin"])), db: Session = Depends(get_db)):
    return crud.get_assignments(db)

@app.get("/api/assignments/teacher/{teacher_id}")
def read_assignments_by_teacher_api(
    teacher_id: int,
    user=Depends(require_roles(["admin", "docente"])),
    db: Session = Depends(get_db),
):
    if user.get("role") == "docente":
        teacher = _get_teacher_for_user(db, user)
        if teacher.id != teacher_id:
            raise HTTPException(status_code=403, detail="Solo puedes ver tus asignaciones")

    return crud.get_assignments_by_teacher(db, teacher_id)

@app.get("/api/assignments/course/{course_id}")
def read_assignments_by_course_api(
    course_id: int,
    user=Depends(require_roles(["admin", "docente", "estudiante"])),
    db: Session = Depends(get_db),
):
    if user.get("role") == "docente":
        teacher = _get_teacher_for_user(db, user)
        if course_id not in _teacher_assigned_course_ids(db, teacher.id):
            raise HTTPException(status_code=403, detail="Solo puedes ver tus cursos asignados")

    return crud.get_assignments_by_course(db, course_id)


@app.delete("/api/assignments/{assignment_id}")
def delete_assignment_api(
    assignment_id: int,
    user=Depends(require_roles(["admin"])),
    db: Session = Depends(get_db),
):
    deleted = crud.delete_assignment(db, assignment_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Asignación no encontrada")
    return {"ok": True, "id": assignment_id}


@app.put("/api/assignments/{assignment_id}")
def update_assignment_api(
    assignment_id: int,
    assignment: schemas.AssignmentUpdate,
    user=Depends(require_roles(["admin"])),
    db: Session = Depends(get_db),
):
    updated = crud.update_assignment(db, assignment_id, schemas.AssignmentCreate(**assignment.model_dump()))
    if not updated:
        raise HTTPException(status_code=404, detail="Asignación no encontrada")
    return updated


# ── Schedules (Horario) ──
def _enrich_session(session: models.CourseSession, db: Session) -> dict:
    course = db.query(models.Course).filter(models.Course.id == session.course_id).first()
    teacher = None
    if getattr(session, "teacher_id", None) is not None:
        teacher = db.query(models.Teacher).filter(models.Teacher.id == session.teacher_id).first()

    teacher_name = None
    if teacher:
        teacher_name = teacher.name or f"{teacher.first_name or ''} {teacher.last_name or ''}".strip() or teacher.email

    return {
        "id": session.id,
        "course_id": session.course_id,
        "teacher_id": getattr(session, "teacher_id", None),
        "teacher_name": teacher_name,
        "course_code": course.code if course else None,
        "course_name": course.name if course else None,
        "career_id": course.career_id if course else None,
        "day_of_week": session.day_of_week,
        "start_time": session.start_time,
        "end_time": session.end_time,
        "classroom": session.classroom,
        "section": session.section,
        "modality": session.modality,
    }


@app.post("/api/schedules/", response_model=schemas.CourseSession, status_code=201)
def create_schedule_api(
    session: schemas.CourseSessionCreate,
    user=Depends(require_roles(["admin"])),
    db: Session = Depends(get_db),
):
    try:
        db_session = crud.create_session(db, session)
        return _enrich_session(db_session, db)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))


@app.get("/api/schedules/")
def list_schedules_api(
    career_id: int | None = None,
    course_id: int | None = None,
    user=Depends(require_roles(["admin", "docente", "estudiante"])),
    db: Session = Depends(get_db),
):
    sessions = crud.get_sessions(db, career_id=career_id, course_id=course_id)

    if user.get("role") == "docente":
        teacher = _get_teacher_for_user(db, user)
        allowed_ids = _teacher_assigned_course_ids(db, teacher.id)
        sessions = [s for s in sessions if s.course_id in allowed_ids]

    return [_enrich_session(s, db) for s in sessions]


@app.delete("/api/schedules/{session_id}")
def delete_schedule_api(
    session_id: int,
    user=Depends(require_roles(["admin"])),
    db: Session = Depends(get_db),
):
    session = crud.delete_session(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sesión no encontrada")
    return {"message": "Sesión eliminada"}