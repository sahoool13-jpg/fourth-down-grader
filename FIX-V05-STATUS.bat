@echo off
title 4TH DOWN v0.5 model-status hotfix
cd /d "%~dp0"
echo ============================================================
echo 4TH DOWN v0.5 - Model Status Hotfix
echo ============================================================
echo.
node scripts\fix-v05-modelstatus.mjs
if errorlevel 1 (
  echo.
  echo Hotfix failed. Do NOT commit yet.
  pause
  exit /b 1
)
echo.
echo Running full test suite...
call npm test
if errorlevel 1 (
  echo.
  echo Tests still failed. Do NOT commit yet.
  pause
  exit /b 1
)
echo.
echo ============================================================
echo HOTFIX APPLIED AND ALL TESTS PASSED
echo ============================================================
pause
