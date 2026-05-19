# SGAU — Sistema de Gestión Académica Universitaria
## Resumen de Estado del Proyecto (Abril 2026)

---

## 📋 RESUMEN EJECUTIVO

**SGAU** es un sistema académico multi-servicio basado en **FastAPI + PostgreSQL + Docker Compose**, con arquitectura de microservicios orquestados por un gateway (puerto 8002).

**Estado General**: ✅ **FUNCIONAL Y ESTABLE**
- 22 contenedores activos (8 servicios + 8 BD + dependencias)
- Todos los servicios reportan salud ✓
- 10 estudiantes, 20 docentes, 3 carreras, ~160 cursos creados
- Filtros, búsqueda, edición de perfiles implementados
- Permisos por rol (admin, docente, estudiante) validados

---

## 🏗️ ARQUITECTURA DEL SISTEMA

### Microservicios (Docker)
```
┌─────────────────────────────────────────────────────────────┐
│                    GATEWAY SERVICE (8002)                   │ ← Frontend + Proxy
├─────────────────────────────────────────────────────────────┤
│ auth-service    │ student_service │ academic_service        │
│    (8000)       │     (8001)      │      (8003)             │ ← Core APIs
├─────────────────────────────────────────────────────────────┤
│ enrollment_service │ grades_service │ payment_service       │
│      (8004)        │     (8005)     │      (8006)           │ ← Servicios auxiliares
├─────────────────────────────────────────────────────────────┤
│            reporting_service (8001)                         │
├─────────────────────────────────────────────────────────────┤
│ PostgreSQL DBs: auth-db, student-db, academic-db, etc.     │
└─────────────────────────────────────────────────────────────┘
```

### Carpetas Principales
```
sgau/
├── gateway_service/          ← Frontend + Proxy HTTP
│   ├── main.py              (rutas proxy + FileResponse)
│   ├── index.html           (dashboard admin/docente/estudiante)
│   ├── login.html           (página login)
│   └── styles.css, script.js
├── auth-service/            ← Autenticación (JWT)
│   ├── app/main.py
│   └── app/schemas.py       (validación email @ucc.edu.co)
├── student_service/         ← Gestión estudiantes
│   ├── app/routes.py        (GET/POST/PUT /students/)
│   ├── app/crud.py          (filtros por document_id y program)
│   └── app/models.py
├── academic_offer_service/  ← Gestión docentes, cursos, carreras
│   ├── main.py
│   └── crud.py              (enriquece docentes con career_codes)
├── enrollment_service/      ← Matrículas
├── grades_service/          ← Calificaciones
├── payment_service/         ← Pagos
├── reporting_service/       ← Reportes
├── create_ucc_users.py      ← SEED: crea 20 docentes + 10 estudiantes
└── docker-compose.yml       ← Orquestación
```

---

## ✅ LO QUE ESTÁ IMPLEMENTADO

### 1. **Módulo de Estudiantes** ⭐ (Recién completado)
- ✅ **Tabla de listado**: columnas ID, Cédula, Nombre, Carrera, Email, Estado
- ✅ **Filtros funcionales**:
  - Búsqueda por cédula (document_id)
  - Selector de carrera (todas las carreras, ADM, DER, ISIS)
- ✅ **Edición de perfil**:
  - Admin: puede cambiar todo (nombre, apellido, **carrera**)
  - Estudiante: puede editar solo nombre/apellido (NO carrera)
- ✅ **Crear estudiante**: formulario con select de carrera
- ✅ **Eliminación**: botón eliminar presente
- ✅ **Backend con permisos**: validaciones en `PUT /students/{id}`
- ✅ **10 estudiantes seed** con nombres compuestos, cédulas realistas, carreras asignadas

### 2. **Módulo de Docentes** ⭐
- ✅ **Tabla mejorada**: cédula, carrera, filtros por cédula y carrera
- ✅ **Crear docente**: formulario integrado con auth-service
- ✅ **Backend**: enriquece docentes con `career_codes` (cursos asignados)
- ✅ **Nombres compuestos**: 2 nombres, 2 apellidos
- ✅ **20 docentes seed**: distribuidos en DER, ISIS, ADM

### 3. **Autenticación y Autorización**
- ✅ JWT token válido, roles: admin, docente, estudiante
- ✅ Login en `http://localhost:8002/` con credenciales
- ✅ Autocomplete básico en login (form autocomplete="on")
- ✅ Validación email @ucc.edu.co en auth-service

### 4. **Dashboard Principal**
- ✅ Panel de control para admin
- ✅ Navegación por módulos (Estudiantes, Docentes, Academic, Config)
- ✅ Indicadores: estudiantes (10), docentes (21), carreras (3)
- ✅ Salud de servicios mostrada (7/7 ✓)

### 5. **Datos Académicos**
- ✅ 3 carreras: DER (Derecho), ISIS (Ingeniería de Sistemas), ADM (Administración)
- ✅ ~160 cursos total (63 DER, 49 ISIS, 48 ADM)
- ✅ Asignaciones docente-curso: 186 registros

### 6. **Infraestructura**
- ✅ Docker Compose con 22 contenedores
- ✅ 8 bases de datos PostgreSQL (cada servicio + auth)
- ✅ Gateway proxy HTTP (forwarding autorización)
- ✅ CORS habilitado para desarrollo
- ✅ Health checks en `/health` endpoint

---

## ❌ LO QUE FALTA O ESTÁ INCOMPLETO

### 1. **Matrículas/Enrollments** ⚠️
- ❌ API `/enrollments/` existe pero NO integrada en frontend
- ⚠️ Falta UI para que estudiante vea sus cursos inscritos
- ⚠️ Falta flujo admin para matricular estudiantes

### 2. **Calificaciones (Grades Service)** ⚠️
- ⚠️ API existe (`/grades/`) pero NO integrada en frontend
- ❌ Estudiante NO puede ver notas
- ❌ Docente NO puede registrar calificaciones
- ❌ Tabla de notas no presente

### 3. **Pagos (Payment Service)** ⚠️
- ⚠️ API existe pero NO integrada
- ❌ No hay UI para gestionar pagos

### 4. **Reportes (Reporting Service)** ⚠️
- ⚠️ API existe pero interface mínima
- ❌ Reportes consolidados no accesibles

### 5. **Horarios** ❌
- ❌ No hay módulo de horarios en academic_service
- ❌ Faltan endpoints para crear/listar horarios

### 6. **Roles y Permisos Finos** ⚠️
- ⚠️ Docente no puede ver lista de estudiantes de sus cursos
- ⚠️ Estudiante no puede filtrar cursos disponibles
- ⚠️ Falta distinción entre visualización y edición por rol

### 7. **Frontend - Secciones Incompletas**
- ⚠️ Botones de "Mis cursos" y "Materias inscritas" existen pero sin funcionalidad
- ⚠️ Sección Academic: "Horario" vacía
- ⚠️ Sección Academic: "Asignaciones" y "Matriculaciones" no totalmente funcionales

### 8. **Datos de Prueba**
- ⚠️ Jorge y María (IDs 1 y 2) sin `user_id` válido en auth (no pueden hacer login)
- ⚠️ Falta población de matrículas (enrollments) para estudiantes

### 9. **Validación y UX**
- ⚠️ Formularios sin validación robusta en frontend
- ⚠️ Mensajes de error genéricos
- ⚠️ Sin confirmación antes de eliminar

### 10. **Testing**
- ❌ No hay tests unitarios ni de integración
- ❌ No hay script de pruebas automatizadas

---

## 🐛 PROBLEMAS CONOCIDOS

### Críticos
1. **Dos estudiantes sin user_id en auth**: Jorge (jorge.gomez@ucc.edu.co) y María (maria.lopez@ucc.edu.co)
   - **Causa**: Conflicto 409 al crear usuario en auth-service
   - **Impacto**: No pueden hacer login
   - **Solución**: Ejecutar manualmente o agregar lógica para crear con user_id manual

2. **Rutas FileResponse requieren path absoluto**: Gateway levanta pero servía 404 hasta corregir `os.path.join()`
   - **Estado**: ✅ Arreglado
   - **Lección**: En Docker, rutas relativas no funcionan

### Moderados
3. **Permisos de actualización**: Estudiante puede cambiar carrera si envía en payload (aunque frontend no lo permite)
   - **Mitigation**: Backend valida y elimina `program` del payload si es estudiante
   - **Mejora**: Agregar validación más estricta en schemas

4. **Matriculaciones**: No hay endpoint para listar matrículas de un estudiante
   - **Workaround**: Query directa a enrollment-db
   - **Fix**: Agregar `GET /enrollments/me` en enrollment_service

### Menores
5. **Autocomplete de login**: Funciona pero sin inteligencia (no sugiere emails previos)
6. **Filtros lentos**: Si hay +1000 estudiantes, los filtros pueden ser lentos (sin paginación)
7. **Nombres de estudiantes 1 y 2**: Son "Jorge Gómez" y "María López" (sin nombres compuestos como los demás)

---

## 🔧 CÓMO LEVANTAR EL SISTEMA

### Prerequisitos
- Docker Desktop activo
- Python 3.10+ (si quieres ejecutar seed manualmente)
- ~5GB de espacio en disco

### Pasos

```bash
# 1. Navegar a carpeta del proyecto
cd C:\Users\Lenovo LOQ\Desktop\sgau

# 2. Levantar todo (incluye rebuild)
docker compose up -d

# 3. Esperar ~20-30 seg a que servicios inicien
docker compose ps  # Ver estado

# 4. Crear datos de prueba (docentes, estudiantes)
python create_ucc_users.py

# 5. Abrir navegador
# http://localhost:8002/
# Login: admin@ucc.edu.co / Admin123*
```

### Troubleshooting

**Error: "port 8002 already in use"**
```bash
docker compose down  # Detener todo
docker compose up -d
```

**Error: "cannot find Python"**
- Verificar que Python esté en PATH
- Alternativa: Ejecutar directamente seed manualmente con UI admin

**Servicios no levantado**
```bash
docker compose logs student_service --tail=50  # Ver logs específicos
```

---

## 📊 DATOS DE PRUEBA Y CREDENCIALES

### Admin
```
Email: admin@ucc.edu.co
Contraseña: Admin123*
Rol: admin
Acceso: dashboard completo + crear usuarios/docentes/estudiantes
```

### Docentes (todos con contraseña según patrón)
**Derecho** (contraseña: `Derecho2026*`)
- carlos.mendoza@ucc.edu.co
- patricia.restrepo@ucc.edu.co
- andres.vargas@ucc.edu.co
- lucia.herrera@ucc.edu.co
- fernando.gomez@ucc.edu.co
- claudia.pinto@ucc.edu.co
- rodrigo.castro@ucc.edu.co

**Ingeniería de Sistemas** (contraseña: `Sistemas2026*`)
- jaime.torres@ucc.edu.co
- sandra.morales@ucc.edu.co
- hector.jimenez@ucc.edu.co
- diana.ospina@ucc.edu.co
- miguel.ramos@ucc.edu.co
- camila.diaz@ucc.edu.co
- ernesto.silva@ucc.edu.co

**Administración** (contraseña: `Admon2026*`)
- rosa.martinez@ucc.edu.co
- tomas.guerrero@ucc.edu.co
- isabel.cardenas@ucc.edu.co
- alberto.nunez@ucc.edu.co
- valentina.rios@ucc.edu.co
- guillermo.pena@ucc.edu.co

### Estudiantes (todos con contraseña: `123`)
```
laura.mejia@ucc.edu.co              Administración de Empresas
felipe.suarez@ucc.edu.co            Ingeniería de Sistemas
valeria.romero@ucc.edu.co           Derecho
nicolas.marin@ucc.edu.co            Administración de Empresas
camilo.rueda@ucc.edu.co             Ingeniería de Sistemas
daniela.arias@ucc.edu.co            Derecho
sebastian.pardo@ucc.edu.co          Administración de Empresas
paula.navarro@ucc.edu.co            Ingeniería de Sistemas
jorge.gomez@ucc.edu.co              ⚠️ Sin user_id (no puede login)
maria.lopez@ucc.edu.co              ⚠️ Sin user_id (no puede login)
```

---

## 💡 SUGERENCIAS PARA CONTINUAR

### Prioridad ALTA (Próximas 1-2 semanas)

1. **Completar Módulo de Matrículas**
   - Crear UI para que admin vea matrículas por estudiante
   - Agregar botón "Matricular estudiante" en cada carrera
   - Endpoint: `GET /enrollments/student/{student_id}`
   - UI: tabla con cursos inscritos, botón para agregar/remover

2. **Completar Módulo de Calificaciones**
   - Docente: UI para registrar notas (tabla de estudiantes + input nota)
   - Estudiante: UI para ver sus calificaciones
   - Endpoint: `POST /grades/` para registrar, `GET /grades/student/{id}`
   - Validación: solo docente asignado al curso puede calificar

3. **Validación Frontend Robusta**
   - Formularios con validaciones en vivo (email, cédula, etc.)
   - Mensajes de error específicos
   - Confirmación de eliminación

4. **Corregir Jorge y María**
   - Opción A: Re-ejecutar seed pero con manejo especial
   - Opción B: Crear manualmente en UI admin
   - Verificar que queden con user_id válido para login

### Prioridad MEDIA (Semanas 2-4)

5. **Paginación y Performance**
   - Agregar paginación en tablas (limit=20, offset=0)
   - Índices en PostgreSQL para document_id y program
   - Caché de carreras/cursos en frontend

6. **Mejorar Flujo de Docentes**
   - Docente: listar "mis estudiantes" (de sus cursos asignados)
   - Docente: dashboard con cursos a dictar
   - Ver asignaciones por semestre

7. **Módulo de Horarios**
   - Modelo: `Horario` (curso_id, day, start_time, end_time, sala)
   - CRUD básico en academic_service
   - Calendario visual en frontend (opcional)

8. **Tests Automatizados**
   - pytest para backend (20-30 tests críticos)
   - Playwright para frontend (flujos principales)
   - CI/CD simple (pre-commit hook o GitHub Actions)

### Prioridad BAJA (Futuro)

9. **Pagos y Reportes**
   - Integrar payment_service UI
   - Reportes de PDF (con librería como `reportlab`)
   - Exportar datos a Excel

10. **Seguridad**
    - Rate limiting en login
    - HTTPS en producción
    - Validación CSRF
    - Encriptación de campos sensibles

11. **Mejorar UX**
    - Dark mode
    - Notificaciones en tiempo real (WebSocket)
    - Búsqueda global
    - Exportar/importar datos en bulk

---

## 🛠️ STACK TÉCNICO RESUMEN

| Capa | Tecnología | Version |
|------|-----------|---------|
| **Frontend** | HTML5 + JavaScript vanilla | ES6+ |
| **Backend** | FastAPI + Uvicorn | 0.136.1 |
| **ORM** | SQLAlchemy | 2.x |
| **Auth** | JWT (PyJWT) | Custom |
| **DB** | PostgreSQL | 15-alpine |
| **Proxy** | httpx + FastAPI proxy routes | 0.28.1 |
| **Contenedorización** | Docker + Docker Compose | latest |
| **Python** | Python | 3.10 / 3.11 / 3.12 |

---

## 📂 ARCHIVOS CLAVE PARA EDITAR

### Si quieres agregar una nueva ruta estudiante:
- Editar: `student_service/app/routes.py` (agregar @router.get/post)
- Editar: `student_service/app/crud.py` (agregar lógica DB)
- Editar: `gateway_service/index.html` (agregar UI + fetch)

### Si quieres agregar filtros:
- Backend: `student_service/app/crud.py` → función `get_students()`
- Frontend: `gateway_service/index.html` → función `loadStudents()`

### Si quieres crear nuevo servicio:
1. Crear carpeta `nuevo_service/` con estructura similar a `student_service/`
2. Agregar en `docker-compose.yml`
3. Agregar proxy en `gateway_service/main.py` → `@app.api_route("/ruta/{path:path}")`
4. Agregar en `index.html` si es necesario

### Si quieres corregir semillas:
- Editar: `create_ucc_users.py` → función `create_estudiante()`
- Ejecutar: `python create_ucc_users.py`

---

## 🎯 CHECKLIST PARA PRÓXIMO TRABAJADOR

- [ ] Leer este documento completo
- [ ] Levantar sistema: `docker compose up -d`
- [ ] Ejecutar seed: `python create_ucc_users.py`
- [ ] Acceder a http://localhost:8002 como admin
- [ ] Navegar a Estudiantes → Listar → probar filtros
- [ ] Editar un estudiante como admin (cambiar carrera)
- [ ] Loguearse como estudiante (laura.mejia@ucc.edu.co) → ver que NO puede cambiar carrera
- [ ] Revisar logs: `docker compose logs -f gateway_service`
- [ ] Si falla algo: revisar sección "Troubleshooting"

---

## 📞 CONTACTO / HISTORIAL

**Última actualización**: 29 de Abril de 2026  
**Estado**: ✅ FUNCIONAL - Módulo estudiantes completado  
**Próximo paso recomendado**: Matrículas + Calificaciones

---

**Fin del documento de contexto**
