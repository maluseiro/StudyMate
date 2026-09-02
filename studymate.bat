@echo off
title StudyMate
cd /d "%~dp0"

where node >/dev/null 2>nul
if errorlevel 1 (
  echo.
  echo   Falta Node.js. Instalalo desde https://nodejs.org y volve a abrir este archivo.
  echo.
  pause
  exit /b 1
)

node -e "require('node:sqlite')" >/dev/null 2>nul
if errorlevel 1 (
  echo.
  echo   Tu Node.js es muy viejo: StudyMate necesita la version 22.5 o mas nueva.
  node --version
  echo   Actualizalo desde https://nodejs.org y volve a abrir este archivo.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo   Primera vez: instalando dependencias, esto tarda unos segundos...
  echo.
  call npm install || (echo   Fallo la instalacion. & pause & exit /b 1)
)

set SM_OPEN=1
node --disable-warning=ExperimentalWarning server\index.js

echo.
echo   StudyMate se cerro.
pause
