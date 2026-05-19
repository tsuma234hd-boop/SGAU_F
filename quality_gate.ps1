param(
    [string]$AuthSecretKey = "",
    [switch]$SkipBuild,
    [switch]$RunExtended
)

$ErrorActionPreference = "Stop"

Write-Host "`n=== SGAU Quality Gate ===" -ForegroundColor Cyan

if (-not $env:AUTH_SECRET_KEY) {
    if ($AuthSecretKey) {
        $env:AUTH_SECRET_KEY = $AuthSecretKey
    } else {
        $env:AUTH_SECRET_KEY = "local_dev_only_change_me_please_rotate"
    }
    Write-Host "AUTH_SECRET_KEY configurado en sesion actual." -ForegroundColor DarkGray
}

$composeArgs = @("compose", "up", "-d")
if (-not $SkipBuild) {
    $composeArgs += "--build"
}

Write-Host "Levantando stack Docker..." -ForegroundColor Cyan
& docker @composeArgs
if ($LASTEXITCODE -ne 0) {
    throw "docker compose up fallo"
}


Write-Host "Esperando health estable del gateway... (hasta 60s)" -ForegroundColor Cyan
$healthy = $false
$gatewayReachable = $false
$lastHealth = $null
for ($i = 1; $i -le 30; $i++) {
    try {
        $health = Invoke-RestMethod -Method GET -Uri "http://localhost:8002/health" -TimeoutSec 8
        $lastHealth = $health
        if ($health.gateway -eq "ok") {
            $gatewayReachable = $true
            $down = @($health.services.PSObject.Properties | Where-Object { $_.Value -eq "down" })
            if ($down.Count -eq 0) {
                $healthy = $true
                break
            }
        }
    } catch {
    }
    Start-Sleep -Seconds 2
}

if (-not $gatewayReachable) {
    Write-Host "[DIAGNOSTICO] Estado de contenedores:" -ForegroundColor Yellow
    docker compose ps
    Write-Host "[DIAGNOSTICO] Ultimos logs del gateway:" -ForegroundColor Yellow
    docker compose logs --tail=40 gateway_service
    throw "Gateway no respondio en /health a tiempo"
}

if (-not $healthy) {
    Write-Host "[ADVERTENCIA] Gateway estable pero hay servicios reportados como down/degraded. Continuando con pruebas..." -ForegroundColor Yellow
    if ($lastHealth) {
        $lastHealthJson = $lastHealth | ConvertTo-Json -Depth 5 -Compress
        Write-Host "[ADVERTENCIA] Ultimo health: $lastHealthJson" -ForegroundColor DarkYellow
    }
}

Write-Host "Ejecutando pruebas por microservicio (unitarias/integracion)..." -ForegroundColor Cyan
$testCommands = @(
    "docker compose run --rm auth-service pytest -q tests",
    "docker compose run --rm student_service pytest -q tests",
    "docker compose run --rm academic_service pytest -q tests",
    "docker compose run --rm enrollment_service pytest -q tests",
    "docker compose run --rm grades_service pytest -q tests",
    "docker compose run --rm payment_service pytest -q tests",
    "docker compose run --rm reporting_service pytest -q tests",
    "docker compose run --rm gateway_service pytest -q tests"
)

foreach ($cmd in $testCommands) {
    Write-Host "-> $cmd" -ForegroundColor DarkGray
    Invoke-Expression $cmd
    if ($LASTEXITCODE -ne 0) {
        throw "Fallo en pruebas: $cmd"
    }
}

Write-Host "Ejecutando smoke_test.ps1..." -ForegroundColor Cyan
& powershell -ExecutionPolicy Bypass -File ".\\smoke_test.ps1"
if ($LASTEXITCODE -ne 0) {
    throw "Smoke test fallo"
}

if ($RunExtended) {
    Write-Host "Ejecutando test_roles.ps1 (extendido)..." -ForegroundColor Cyan
    & powershell -ExecutionPolicy Bypass -File ".\\test_roles.ps1"
    if ($LASTEXITCODE -ne 0) {
        throw "test_roles.ps1 fallo"
    }
}

Write-Host "`nQuality gate OK." -ForegroundColor Green
