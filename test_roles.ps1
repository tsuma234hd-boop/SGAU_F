# ═══════════════════════════════════════════════════════════════════
#  test_roles.ps1  –  Prueba de flujos por rol (admin / docente / estudiante)
#  Uso:  .\test_roles.ps1
# ═══════════════════════════════════════════════════════════════════

# ── Configuración de URLs ────────────────────────────────────────
$AUTH        = "http://localhost:8000"
$STUDENT_SVC = "http://localhost:8001"
$ACADEMIC    = "http://localhost:8003"
$ENROLLMENT  = "http://localhost:8004"
$GRADES      = "http://localhost:8005"
$REPORTING   = "http://localhost:8006"
$PAYMENT     = "http://localhost:8007"

# ── Credenciales de prueba  (ajusta si usas otras) ───────────────
$ADMIN_EMAIL    = "admin@ucc.edu.co"
$ADMIN_PASS     = "admin123"

$DOCENTE_EMAIL  = "docente@ucc.edu.co"
$DOCENTE_PASS   = "docente123"

$STUDENT_EMAIL  = "estudiante@ucc.edu.co"
$STUDENT_PASS   = "estudiante123"

# ── Helpers ──────────────────────────────────────────────────────
function Print-Title($text) {
    Write-Host "`n══════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  $text" -ForegroundColor Cyan
    Write-Host "══════════════════════════════════════════" -ForegroundColor Cyan
}

function Print-Step($text) {
    Write-Host "`n▶ $text" -ForegroundColor Yellow
}

function Show-Response($label, $response, $body) {
    $color = if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) { "Green" } else { "Red" }
    Write-Host "  [$($response.StatusCode)]  $label" -ForegroundColor $color
    try {
        $json = $body | ConvertFrom-Json | ConvertTo-Json -Depth 4
        Write-Host $json -ForegroundColor DarkGray
    } catch {
        Write-Host $body -ForegroundColor DarkGray
    }
}

function Invoke-API($method, $url, $body, $token) {
    $headers = @{ "Content-Type" = "application/json" }
    if ($token) { $headers["Authorization"] = "Bearer $token" }

    try {
        $params = @{
            Method  = $method
            Uri     = $url
            Headers = $headers
        }
        if ($body) { $params["Body"] = ($body | ConvertTo-Json -Depth 5) }

        $response = Invoke-WebRequest @params -ErrorAction Stop
        return @{ Status = $response.StatusCode; Body = $response.Content }
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        $raw = ""
        try { $raw = $_.ErrorDetails.Message } catch {}
        return @{ Status = $statusCode; Body = $raw }
    }
}

function Login($email, $password) {
    $result = Invoke-API "POST" "$AUTH/login" @{ email = $email; password = $password }
    if ($result.Status -eq 200) {
        $token = ($result.Body | ConvertFrom-Json).access_token
        Write-Host "  ✔ Login OK  →  token obtenido" -ForegroundColor Green
        return $token
    }
    Write-Host "  ✘ Login FALLIDO [$($result.Status)]: $($result.Body)" -ForegroundColor Red
    return $null
}

# ════════════════════════════════════════════════════════════════════
#  BLOQUE 1 – ADMIN
# ════════════════════════════════════════════════════════════════════
Print-Title "BLOQUE 1 — ADMIN"

Print-Step "Login admin"
$adminToken = Login $ADMIN_EMAIL $ADMIN_PASS

if ($adminToken) {

    Print-Step "Crear carrera (solo admin)"
    $r = Invoke-API "POST" "$ACADEMIC/api/careers/" @{
        code        = "TEST-CAR"
        name        = "Carrera de Prueba"
        description = "Creada desde test_roles.ps1"
    } $adminToken
    Show-Response "POST /api/careers/" @{ StatusCode = $r.Status } $r.Body

    Print-Step "Crear curso (solo admin)"
    $r = Invoke-API "POST" "$ACADEMIC/api/courses/" @{
        codigo      = "TEST-101"
        nombre      = "Curso de Prueba"
        creditos    = 3
        career_id   = 1
        dia         = "lunes"
        hora_inicio = "08:00"
        hora_fin    = "10:00"
        aula        = "210"
    } $adminToken
    Show-Response "POST /api/courses/" @{ StatusCode = $r.Status } $r.Body

    Print-Step "Listar docentes (solo admin)"
    $r = Invoke-API "GET" "$ACADEMIC/api/teachers/" $null $adminToken
    Show-Response "GET /api/teachers/" @{ StatusCode = $r.Status } $r.Body

    Print-Step "Agregar deuda a estudiante ID=1 (solo admin)"
    $r = Invoke-API "POST" "$PAYMENT/payments/accounts/1/debt" @{ amount = 500000 } $adminToken
    Show-Response "POST /payments/accounts/1/debt" @{ StatusCode = $r.Status } $r.Body

    Print-Step "Reporte global de curso ID=1 (solo admin)"
    $r = Invoke-API "GET" "$REPORTING/reports/course/1" $null $adminToken
    Show-Response "GET /reports/course/1" @{ StatusCode = $r.Status } $r.Body
}

# ════════════════════════════════════════════════════════════════════
#  BLOQUE 2 – DOCENTE
# ════════════════════════════════════════════════════════════════════
Print-Title "BLOQUE 2 — DOCENTE"

Print-Step "Login docente"
$docenteToken = Login $DOCENTE_EMAIL $DOCENTE_PASS

if ($docenteToken) {

    Print-Step "Ver mis cursos asignados"
    $r = Invoke-API "GET" "$ACADEMIC/api/courses/" $null $docenteToken
    Show-Response "GET /api/courses/ (filtrado por docente)" @{ StatusCode = $r.Status } $r.Body

    Print-Step "Ver mis asignaciones"
    # Obtener teacher_id desde el perfil
    $meR = Invoke-API "GET" "$AUTH/profile" $null $docenteToken
    $userId = ($meR.Body | ConvertFrom-Json).usuario.user_id
    $teacherR = Invoke-API "GET" "$ACADEMIC/api/teachers/user/$userId" $null $docenteToken
    $teacherId = ($teacherR.Body | ConvertFrom-Json).id
    Write-Host "  teacher_id = $teacherId" -ForegroundColor DarkGray

    $r = Invoke-API "GET" "$ACADEMIC/api/assignments/teacher/$teacherId" $null $docenteToken
    Show-Response "GET /api/assignments/teacher/$teacherId" @{ StatusCode = $r.Status } $r.Body

    Print-Step "Cargar nota de estudiante (course_id que tenga asignado)"
    # Extrae el primer course_id de sus asignaciones
    $assignments = $r.Body | ConvertFrom-Json
    if ($assignments -and $assignments.Count -gt 0) {
        $courseId = $assignments[0].course_id
        $r2 = Invoke-API "POST" "$GRADES/grades/" @{
            student_id = 1
            course_id  = $courseId
            score      = 4.2
        } $docenteToken
        Show-Response "POST /grades/ (curso asignado course_id=$courseId)" @{ StatusCode = $r2.Status } $r2.Body

        Print-Step "Intentar cargar nota en un curso NO asignado (espera 403)"
        $r3 = Invoke-API "POST" "$GRADES/grades/" @{
            student_id = 1
            course_id  = 9999
            score      = 3.0
        } $docenteToken
        Show-Response "POST /grades/ (curso no asignado → debe ser 403)" @{ StatusCode = $r3.Status } $r3.Body
    } else {
        Write-Host "  Sin asignaciones para probar notas" -ForegroundColor DarkYellow
    }

    Print-Step "Intentar crear carrera (debe retornar 403)"
    $r = Invoke-API "POST" "$ACADEMIC/api/careers/" @{
        code = "HACK"
        name = "Hack career"
    } $docenteToken
    Show-Response "POST /api/careers/ con token docente → debe ser 403" @{ StatusCode = $r.Status } $r.Body
}

# ════════════════════════════════════════════════════════════════════
#  BLOQUE 3 – ESTUDIANTE
# ════════════════════════════════════════════════════════════════════
Print-Title "BLOQUE 3 — ESTUDIANTE"

Print-Step "Login estudiante"
$studentToken = Login $STUDENT_EMAIL $STUDENT_PASS

if ($studentToken) {

    Print-Step "Ver mi perfil estudiantil"
    $r = Invoke-API "GET" "$STUDENT_SVC/students/me" $null $studentToken
    Show-Response "GET /students/me" @{ StatusCode = $r.Status } $r.Body

    Print-Step "Matricularme en el curso ID=1 (flujo simplificado)"
    $r = Invoke-API "POST" "$ENROLLMENT/enrollments/me" @{ course_id = 1 } $studentToken
    Show-Response "POST /enrollments/me" @{ StatusCode = $r.Status } $r.Body

    Print-Step "Ver mis materias matriculadas"
    $r = Invoke-API "GET" "$ENROLLMENT/enrollments/me/courses" $null $studentToken
    Show-Response "GET /enrollments/me/courses" @{ StatusCode = $r.Status } $r.Body

    Print-Step "Ver mis notas"
    $r = Invoke-API "GET" "$GRADES/grades/me" $null $studentToken
    Show-Response "GET /grades/me" @{ StatusCode = $r.Status } $r.Body

    Print-Step "Ver mi promedio"
    $r = Invoke-API "GET" "$GRADES/grades/me/average" $null $studentToken
    Show-Response "GET /grades/me/average" @{ StatusCode = $r.Status } $r.Body

    Print-Step "Ver mis pagos"
    $r = Invoke-API "GET" "$PAYMENT/payments/me" $null $studentToken
    Show-Response "GET /payments/me" @{ StatusCode = $r.Status } $r.Body

    Print-Step "Ver mi resumen financiero"
    $r = Invoke-API "GET" "$PAYMENT/payments/me/summary" $null $studentToken
    Show-Response "GET /payments/me/summary" @{ StatusCode = $r.Status } $r.Body

    Print-Step "Ver mis deudas"
    $r = Invoke-API "GET" "$PAYMENT/payments/me/debts" $null $studentToken
    Show-Response "GET /payments/me/debts" @{ StatusCode = $r.Status } $r.Body

    Print-Step "Ver mi reporte académico"
    $meR = Invoke-API "GET" "$STUDENT_SVC/students/me" $null $studentToken
    $myStudentId = ($meR.Body | ConvertFrom-Json).id
    $r = Invoke-API "GET" "$REPORTING/reports/student/$myStudentId" $null $studentToken
    Show-Response "GET /reports/student/$myStudentId" @{ StatusCode = $r.Status } $r.Body

    Print-Step "Intentar ver reporte financiero de otro estudiante (debe ser 403)"
    $r = Invoke-API "GET" "$REPORTING/reports/student/9999/financial" $null $studentToken
    Show-Response "GET /reports/student/9999/financial → debe ser 403" @{ StatusCode = $r.Status } $r.Body

    Print-Step "Intentar crear carrera (debe retornar 403)"
    $r = Invoke-API "POST" "$ACADEMIC/api/careers/" @{
        code = "HACK"
        name = "Hack career"
    } $studentToken
    Show-Response "POST /api/careers/ con token estudiante → debe ser 403" @{ StatusCode = $r.Status } $r.Body

    Print-Step "Intentar ver reporte global de curso (debe retornar 403)"
    $r = Invoke-API "GET" "$REPORTING/reports/course/1" $null $studentToken
    Show-Response "GET /reports/course/1 con token estudiante → debe ser 403" @{ StatusCode = $r.Status } $r.Body
}

Print-Title "FIN DE PRUEBAS"
Write-Host "`n  Verde = OK    Rojo = error    Amarillo esperado = 403/409`n" -ForegroundColor White
