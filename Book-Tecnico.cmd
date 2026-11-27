@echo off
rem Book Tecnico - app local (sem login, so nesta maquina). Duplo clique para abrir.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   O Book Tecnico precisa do Node.js 22.5 ou mais novo.
  echo   Baixe e instale em https://nodejs.org e abra este arquivo de novo.
  echo.
  pause
  exit /b 1
)
start "Book Tecnico - feche esta janela para sair" /min node server\local-app.js
