@echo off
setlocal
set "COOLCARE_PROJECT=C:\Users\Lenovo\Documents\xwechat_files\wxid_6k1rnz19065x12_b547\msg\file\2026-08\CoolCare_Database_Handover\inventory-web"
if not exist "%COOLCARE_PROJECT%\start-local.cmd" (
  echo Original project not found. Read docs/independent setup instructions.
  pause
  exit /b 1
)
powershell.exe -NoProfile -Command "try { $r = Invoke-RestMethod -Uri 'http://localhost:3000/api/health' -TimeoutSec 3; if ($r.ready -eq $true) { exit 0 }; exit 1 } catch { exit 1 }"
if not errorlevel 1 (
  echo CoolCare is already running.
  echo Open http://localhost:3000/admin/inventory in your browser.
  pause
  exit /b 0
)
echo Starting your configured CoolCare project. Keep this window open.
echo Then open http://localhost:3000/admin/inventory in your browser.
call "%COOLCARE_PROJECT%\start-local.cmd"
endlocal
