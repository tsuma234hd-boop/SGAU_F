param(
    [string]$GatewayBase = "http://localhost:8002",
    [string]$AdminEmail = "admin@ucc.edu.co",
    [string]$AdminPassword = "Admin123*",
    [string]$TeacherEmail = "ci.docente@ucc.edu.co",
    [string]$TeacherPassword = "DocenteCI2026*",
    [string]$StudentEmail = "ci.estudiante@ucc.edu.co",
    [string]$StudentPassword = "EstudianteCI2026*"
)

$ErrorActionPreference = "Stop"
$results = @()

function Add-Result {
    param(
        [string]$Name,
        [bool]$Passed,
        [string]$Detail
    )

    $script:results += [pscustomobject]@{
        Check  = $Name
        Passed = $Passed
        Detail = $Detail
    }

    if ($Passed) {
        Write-Host "[OK]  $Name - $Detail" -ForegroundColor Green
    } else {
        Write-Host "[FAIL] $Name - $Detail" -ForegroundColor Red
    }
}

function Invoke-Api {
    param(
        [string]$Method,
        [string]$Path,
        $Body = $null,
        [string]$Token = ""
    )

    $uri = "$GatewayBase$Path"
    $headers = @{}
    if ($Token) {
        $headers["Authorization"] = "Bearer $Token"
    }

    try {
        $jsonBody = $null
        if ($null -ne $Body) {
            $jsonBody = $Body | ConvertTo-Json -Depth 8
        }

        $resp = Invoke-WebRequest -Method $Method -Uri $uri -Headers $headers -Body $jsonBody -ContentType "application/json" -TimeoutSec 20
        $parsed = $null
        if ($resp.Content) {
            try { $parsed = $resp.Content | ConvertFrom-Json } catch { $parsed = $resp.Content }
        }

        return @{
            Status = [int]$resp.StatusCode
            Body   = $parsed
            Raw    = $resp.Content
        }
    } catch {
        $status = 0
        $raw = ""
        try { $status = [int]$_.Exception.Response.StatusCode.value__ } catch {}
        try { $raw = $_.ErrorDetails.Message } catch { $raw = $_.Exception.Message }

        $parsed = $null
        if ($raw) {
            try { $parsed = $raw | ConvertFrom-Json } catch { $parsed = $raw }
        }

        return @{
            Status = $status
            Body   = $parsed
            Raw    = $raw
        }
    }
}

function Invoke-ApiWithRetry {
    param(
        [string]$Method,
        [string]$Path,
        $Body = $null,
        [string]$Token = "",
        [int]$MaxAttempts = 10,
        [int]$DelaySeconds = 3,
        [int[]]$SuccessStatuses = @(200)
    )

    $last = $null
    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        $last = Invoke-Api -Method $Method -Path $Path -Body $Body -Token $Token
        if ($SuccessStatuses -contains [int]$last.Status) {
            return $last
        }

        if ($attempt -lt $MaxAttempts) {
            Start-Sleep -Seconds $DelaySeconds
        }
    }

    return $last
}

function Assert-Status {
    param(
        [string]$Name,
        [int]$Actual,
        [int[]]$Expected,
        [string]$Extra = ""
    )

    $ok = $Expected -contains $Actual
    $exp = ($Expected -join ",")
    $detail = "status=$Actual expected=[$exp]"
    if ($Extra) {
        $detail = "$detail $Extra"
    }
    Add-Result -Name $Name -Passed $ok -Detail $detail
    return $ok
}

function Ensure-StudentLogin {
    param(
        [string]$Email,
        [string]$Password
    )

    $login = Invoke-ApiWithRetry -Method "POST" -Path "/auth/login" -Body @{ email = $Email; password = $Password } -MaxAttempts 6 -DelaySeconds 2 -SuccessStatuses @(200)
    if ($login.Status -eq 200) {
        return $login
    }

    $registerResp = Invoke-Api -Method "POST" -Path "/auth/register" -Body @{
        email = $Email
        password = $Password
        role = "estudiante"
        first_name = "Estudiante"
        last_name = "CI"
        document_id = "1234567890"
    }

    if (($registerResp.Status -ne 200) -and ($registerResp.Status -ne 201) -and ($registerResp.Status -ne 409)) {
        return $login
    }

    return Invoke-ApiWithRetry -Method "POST" -Path "/auth/login" -Body @{ email = $Email; password = $Password } -MaxAttempts 8 -DelaySeconds 2 -SuccessStatuses @(200)
}

function Ensure-TeacherLogin {
    param(
        [string]$Email,
        [string]$Password,
        [string]$AdminToken
    )

    $login = Invoke-ApiWithRetry -Method "POST" -Path "/auth/login" -Body @{ email = $Email; password = $Password } -MaxAttempts 6 -DelaySeconds 2 -SuccessStatuses @(200)
    if ($login.Status -eq 200) {
        return $login
    }

    $createResp = Invoke-Api -Method "POST" -Path "/auth/create-user" -Token $AdminToken -Body @{
        email = $Email
        password = $Password
        role = "docente"
        first_name = "Docente"
        last_name = "CI"
        document_id = "1234567891"
    }

    if (($createResp.Status -eq 200 -or $createResp.Status -eq 201) -and $createResp.Body) {
        $teacherUserId = 0
        try { $teacherUserId = [int]$createResp.Body.user_id } catch { $teacherUserId = 0 }

        if ($teacherUserId -gt 0) {
            $null = Invoke-Api -Method "POST" -Path "/academic/api/teachers/" -Token $AdminToken -Body @{
                user_id = $teacherUserId
                email = $Email
                nombres = "Docente"
                apellidos = "CI"
                nombre = "Docente CI"
                document_id = "1234567891"
            }
        }
    }

    return Invoke-ApiWithRetry -Method "POST" -Path "/auth/login" -Body @{ email = $Email; password = $Password } -MaxAttempts 8 -DelaySeconds 2 -SuccessStatuses @(200)
}

Write-Host "`n=== SGAU Smoke Test (Gateway: $GatewayBase) ===`n" -ForegroundColor Cyan

# 1) Health gateway
$health = Invoke-Api -Method "GET" -Path "/health"
Assert-Status -Name "Health endpoint" -Actual $health.Status -Expected @(200) | Out-Null
if ($health.Status -eq 200 -and $health.Body -and $health.Body.services) {
    $down = @()
    for ($attempt = 1; $attempt -le 10; $attempt++) {
        $current = if ($attempt -eq 1) { $health } else { Invoke-Api -Method "GET" -Path "/health" }
        if ($current.Status -ne 200 -or -not $current.Body -or -not $current.Body.services) {
            if ($attempt -lt 10) {
                Start-Sleep -Seconds 2
            }
            continue
        }
        $down = @($current.Body.services.PSObject.Properties | Where-Object { $_.Value -eq "down" } | ForEach-Object { $_.Name })
        if ($down.Count -eq 0) {
            break
        }
        if ($attempt -lt 10) {
            Start-Sleep -Seconds 2
        }
    }

    if ($down.Count -eq 0) {
        Add-Result -Name "Health services" -Passed $true -Detail "todos los servicios reportan ok/degraded"
    } else {
        Add-Result -Name "Health services" -Passed $false -Detail ("servicios down tras reintentos: " + ($down -join ", "))
    }
}

# 2) Login admin
$adminLogin = Invoke-ApiWithRetry -Method "POST" -Path "/auth/login" -Body @{ email = $AdminEmail; password = $AdminPassword } -MaxAttempts 12 -DelaySeconds 3 -SuccessStatuses @(200)
$adminOk = Assert-Status -Name "Login admin" -Actual $adminLogin.Status -Expected @(200)
$adminToken = ""
if ($adminOk -and $adminLogin.Body) {
    $adminToken = [string]$adminLogin.Body.access_token
}

if (-not $adminToken) {
    Add-Result -Name "Admin token" -Passed $false -Detail "no se pudo continuar sin token admin"
} else {
    $adminProfile = Invoke-Api -Method "GET" -Path "/auth/profile" -Token $adminToken
    Assert-Status -Name "Admin profile" -Actual $adminProfile.Status -Expected @(200) | Out-Null

    $careers = Invoke-Api -Method "GET" -Path "/academic/api/careers/" -Token $adminToken
    $careersOk = Assert-Status -Name "Admin careers list" -Actual $careers.Status -Expected @(200)

    if ($careersOk -and $careers.Body -and $careers.Body.Count -gt 0) {
        Add-Result -Name "Carreras disponibles" -Passed $true -Detail ("total=" + $careers.Body.Count)
    } else {
        Add-Result -Name "Carreras disponibles" -Passed $false -Detail "sin carreras o respuesta no valida"
    }
}

# 3) Login estudiante
$studentLogin = Ensure-StudentLogin -Email $StudentEmail -Password $StudentPassword
$studentOk = Assert-Status -Name "Login estudiante" -Actual $studentLogin.Status -Expected @(200)
$studentToken = ""
$studentId = 0
if ($studentOk -and $studentLogin.Body) {
    $studentToken = [string]$studentLogin.Body.access_token
}

if ($studentToken) {
    $studentProfile = Invoke-Api -Method "GET" -Path "/students/me" -Token $studentToken
    if (Assert-Status -Name "Student profile" -Actual $studentProfile.Status -Expected @(200)) {
        try { $studentId = [int]$studentProfile.Body.id } catch { $studentId = 0 }
    }

    $myCourses = Invoke-Api -Method "GET" -Path "/enrollments/me/courses" -Token $studentToken
    Assert-Status -Name "Student enrollments courses" -Actual $myCourses.Status -Expected @(200) | Out-Null

    $myGrades = Invoke-Api -Method "GET" -Path "/grades/me" -Token $studentToken
    Assert-Status -Name "Student grades" -Actual $myGrades.Status -Expected @(200) | Out-Null

    $myDebts = Invoke-Api -Method "GET" -Path "/payments/me/debts" -Token $studentToken
    Assert-Status -Name "Student debts" -Actual $myDebts.Status -Expected @(200) | Out-Null

    $mySummary = Invoke-Api -Method "GET" -Path "/payments/me/summary" -Token $studentToken
    Assert-Status -Name "Student payment summary" -Actual $mySummary.Status -Expected @(200,404) | Out-Null

    if ($studentId -gt 0) {
        $studentReport = Invoke-Api -Method "GET" -Path "/reports/student/$studentId" -Token $studentToken
        Assert-Status -Name "Student report" -Actual $studentReport.Status -Expected @(200,404) | Out-Null
    } else {
        Add-Result -Name "Student report" -Passed $false -Detail "sin student_id para consultar reporte"
    }

    $studentListUsers = Invoke-Api -Method "GET" -Path "/students/" -Token $studentToken
    Assert-Status -Name "RBAC student cannot list students" -Actual $studentListUsers.Status -Expected @(403) | Out-Null

    $studentCreateCareer = Invoke-Api -Method "POST" -Path "/academic/api/careers/" -Token $studentToken -Body @{
        code = "SMK-STU-DENY"
        name = "Debe fallar"
    }
    Assert-Status -Name "RBAC student cannot create career" -Actual $studentCreateCareer.Status -Expected @(403) | Out-Null
}

# 4) Login docente + asignaciones
$teacherLogin = Ensure-TeacherLogin -Email $TeacherEmail -Password $TeacherPassword -AdminToken $adminToken
$teacherOk = Assert-Status -Name "Login docente" -Actual $teacherLogin.Status -Expected @(200)
$teacherToken = ""
if ($teacherOk -and $teacherLogin.Body) {
    $teacherToken = [string]$teacherLogin.Body.access_token
}

if ($teacherToken) {
    $teacherProfile = Invoke-Api -Method "GET" -Path "/auth/profile" -Token $teacherToken
    $teacherUserId = 0
    if (Assert-Status -Name "Teacher profile" -Actual $teacherProfile.Status -Expected @(200)) {
        try { $teacherUserId = [int]$teacherProfile.Body.usuario.user_id } catch { $teacherUserId = 0 }
    }

    if ($teacherUserId -gt 0) {
        $teacherInfo = Invoke-Api -Method "GET" -Path "/academic/api/teachers/user/$teacherUserId" -Token $teacherToken
        $teacherInfoOk = Assert-Status -Name "Teacher by user_id" -Actual $teacherInfo.Status -Expected @(200)
        if ($teacherInfoOk) {
            $teacherId = [int]$teacherInfo.Body.id
            $assignments = Invoke-Api -Method "GET" -Path "/academic/api/assignments/teacher/$teacherId" -Token $teacherToken
            Assert-Status -Name "Teacher assignments" -Actual $assignments.Status -Expected @(200) | Out-Null
        }
    } else {
        Add-Result -Name "Teacher by user_id" -Passed $false -Detail "no se pudo resolver user_id"
    }

    $teacherCreateCareer = Invoke-Api -Method "POST" -Path "/academic/api/careers/" -Token $teacherToken -Body @{
        code = "SMK-TEA-DENY"
        name = "Debe fallar"
    }
    Assert-Status -Name "RBAC teacher cannot create career" -Actual $teacherCreateCareer.Status -Expected @(403) | Out-Null
}

# 5) Control de permisos (estudiante no puede reportes de curso)
if ($studentToken) {
    $studentCourseReport = Invoke-Api -Method "GET" -Path "/reports/course/1" -Token $studentToken
    Assert-Status -Name "RBAC student course report" -Actual $studentCourseReport.Status -Expected @(403) | Out-Null
}

$passed = @($results | Where-Object { $_.Passed }).Count
$total = $results.Count
$failed = $total - $passed

Write-Host "`n=== RESUMEN ===" -ForegroundColor Cyan
Write-Host "Total: $total | OK: $passed | FAIL: $failed"

if ($failed -gt 0) {
    Write-Host "`nChecks fallidos:" -ForegroundColor Yellow
    $results | Where-Object { -not $_.Passed } | ForEach-Object {
        Write-Host " - $($_.Check): $($_.Detail)" -ForegroundColor Yellow
    }
    exit 1
}

Write-Host "`nSmoke test completado sin fallos." -ForegroundColor Green
