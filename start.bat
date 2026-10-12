@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Wencai Agent Shadcn - Live Logs
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required. Install Node.js and run this file again.
  pause
  exit /b 1
)
node "%~dp0scripts\start-local.mjs" %*
if errorlevel 1 (
  echo.
  echo Startup failed. See the live logs above for details.
  pause
  exit /b 1
)
endlocal
