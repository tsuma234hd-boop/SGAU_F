# Pre-Release Checklist (SGAU)

## 1. Seguridad
- [ ] AUTH_SECRET_KEY definido fuera del codigo y fuera del repo.
- [ ] WOMPI_PUBLIC_KEY, WOMPI_PRIVATE_KEY, WOMPI_EVENTS_SECRET y WOMPI_INTEGRITY_SECRET cargados desde entorno.
- [ ] No existen secretos reales en archivos versionados.

## 2. Infraestructura
- [ ] Docker Desktop operativo.
- [ ] `docker compose up -d --build` finaliza sin errores.
- [ ] `docker compose ps` muestra todos los servicios en estado Up.
- [ ] `GET http://localhost:8002/health` reporta gateway ok y servicios sin down.

## 3. Gate de calidad
- [ ] Ejecutar `powershell -ExecutionPolicy Bypass -File .\\quality_gate.ps1`.
- [ ] Resultado final en verde (smoke sin fallos).
- [ ] Si aplica, ejecutar `powershell -ExecutionPolicy Bypass -File .\\quality_gate.ps1 -RunExtended`.

## 4. Flujos criticos validados
- [ ] Login admin, docente y estudiante.
- [ ] Perfil de estudiante (lectura/actualizacion basica).
- [ ] Matriculas (`/enrollments/me/courses`).
- [ ] Notas (`/grades/me`).
- [ ] Pagos (`/payments/me/debts`, `/payments/me/summary`).
- [ ] Reportes (`/reports/student/{id}`).
- [ ] RBAC: estudiante y docente no pueden crear carrera.

## 5. Salida
- [ ] Guardar evidencia de ejecucion (salida de quality gate).
- [ ] Registrar incidentes o endpoints inestables.
- [ ] Solo liberar si no hay FAIL en quality gate.
