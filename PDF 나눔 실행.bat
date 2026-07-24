@echo off
setlocal
title PDF Nanum
cd /d "%~dp0"

set "NPM_CMD=%ProgramFiles%\nodejs\npm.cmd"
if exist "%NPM_CMD%" goto npm_found

where npm.cmd >nul 2>nul
if errorlevel 1 goto node_missing
set "NPM_CMD=npm.cmd"

:npm_found
if /i "%~1"=="--check" (
  call "%NPM_CMD%" --version >nul
  if errorlevel 1 exit /b 1
  echo Ready.
  exit /b 0
)

powershell.exe -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:3000' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; exit 1"
if not errorlevel 1 (
  start "" "http://localhost:3000"
  exit /b 0
)

echo.
echo Starting PDF Nanum...
echo The browser will open automatically.
echo Close this window or press Ctrl+C to stop the app.
echo.

start "" powershell.exe -NoProfile -WindowStyle Hidden -Command "$url = 'http://localhost:3000'; for ($i = 0; $i -lt 90; $i++) { try { $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { Start-Process $url; exit } } catch {}; Start-Sleep -Seconds 1 }"
call "%NPM_CMD%" run dev

if errorlevel 1 (
  echo.
  echo The app could not start. Please capture this window.
  pause
)
exit /b

:node_missing
echo.
echo Node.js was not found.
echo Close and reopen VS Code, then double-click this file again.
echo.
pause
exit /b 1
