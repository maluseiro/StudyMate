@echo off
title StudyMate
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Falta Node.js. Instalalo desde https://nodejs.org y volve a abrir este archivo.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo   Primera vez: instalando dependencias, esto tarda un minuto...
  echo.
  call npm install || (echo   Fallo la instalacion. & pause & exit /b 1)
)

set SM_OPEN=1
node server\index.js

echo.
echo   StudyMate se cerro.
pause
