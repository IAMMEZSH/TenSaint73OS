@echo off
chcp 65001 >nul
title TenSaint73OS - Export Owner Key
setlocal
set "HERE=%~dp0"
set "NODE=%HERE%..\..\runtime\node.exe"
if not exist "%NODE%" set "NODE=%HERE%..\runtime\node.exe"
if not exist "%NODE%" (
  where node >nul 2>nul
  if errorlevel 1 (
    echo [x] Node.js not found. Start the packaged app once, then retry.
    pause
    exit /b 1
  )
  set "NODE=node"
)
"%NODE%" "%HERE%owner-vault.js" export
echo.
pause
