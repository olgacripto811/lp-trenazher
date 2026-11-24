# Проверки LP-тренажёра. Запуск из папки проекта:  powershell -File tests\run-tests.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$html = Join-Path $root 'lp-trenazher.html'
$tmp = Join-Path $env:TEMP 'lp-trenazher-tests'
New-Item -ItemType Directory -Force $tmp | Out-Null
$fail = 0

# 1. Математика модели (Node из VS Code)
Write-Host '== Модель ==' -ForegroundColor Cyan
$env:ELECTRON_RUN_AS_NODE = 1
& "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe" (Join-Path $PSScriptRoot 'test-model.js') $html | Select-String -Pattern 'FAIL|passed' | ForEach-Object { $_.Line }
if ($LASTEXITCODE -ne 0) { $fail++ }

# 2. Интерфейс в headless Edge
Write-Host '== Интерфейс ==' -ForegroundColor Cyan
$page = (Get-Content -Raw -Encoding utf8 $html).Replace('</body>', "<script>`n" + (Get-Content -Raw -Encoding utf8 (Join-Path $PSScriptRoot 'ui-selftest.js')) + "`n</script>`n</body>")
$test = Join-Path $tmp 'selftest.html'
[IO.File]::WriteAllText($test, $page, (New-Object Text.UTF8Encoding $false))
$prof = Join-Path $tmp ('edge-' + [guid]::NewGuid())
$out = Join-Path $tmp 'dom.txt'
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
Start-Process -FilePath $edge -ArgumentList @('--headless', '--disable-gpu', '--no-first-run', "--user-data-dir=$prof", '--virtual-time-budget=5000', '--dump-dom', ('file:///' + ($test -replace '\\', '/'))) -RedirectStandardOutput $out -Wait -NoNewWindow
$dom = Get-Content -Raw -Encoding utf8 $out
$i = $dom.IndexOf('<pre id="selftest">')
if ($i -lt 0) { Write-Host 'Самопроверка интерфейса не запустилась' -ForegroundColor Red; $fail++ }
else {
  $res = $dom.Substring($i, $dom.IndexOf('END</pre>', $i) - $i)
  ($res -split "`n") | Where-Object { $_ -match 'FAIL|MISSING|ERR' } | ForEach-Object { $_ }
  if ($res -notmatch 'ERRORS=0' -or $res -match 'FAIL') { $fail++ }
}
Remove-Item -Recurse -Force $prof -ErrorAction SilentlyContinue

# 3. Никаких сетевых вызовов
$net = Select-String -Path $html -Pattern 'fetch\(|XMLHttpRequest|window\.ethereum|https?://'
if ($net) { Write-Host 'Найдены сетевые вызовы или внешние URL:' -ForegroundColor Red; $net | ForEach-Object { $_.Line.Trim() }; $fail++ }
else { Write-Host 'Сетевых вызовов нет' }

if ($fail) { Write-Host "ЕСТЬ ПРОБЛЕМЫ ($fail)" -ForegroundColor Red; exit 1 } else { Write-Host 'ВСЁ ОК' -ForegroundColor Green }
