@echo off
title Casino Escolar
where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo No se encontro Node.js.
  echo Instalalo desde https://nodejs.org/ y vuelve a ejecutar este archivo.
  echo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Instalando componentes. Esto se hace solo la primera vez...
  call npm install
  if errorlevel 1 (
    echo No se pudieron instalar los componentes.
    pause
    exit /b 1
  )
)
echo.
echo Iniciando Casino Escolar SIN Docker...
echo Cuando aparezca la direccion, abrela en Chrome.
echo Para detener el programa presiona Ctrl+C.
echo.
call npm start
pause
