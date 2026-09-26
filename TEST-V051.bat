@echo off
title 4TH DOWN v0.5.1 gated endgame tests
cd /d "%~dp0"
echo ============================================================
echo 4TH DOWN v0.5.1 - Gated Endgame Intelligence
echo ============================================================
echo.
echo Running full test suite...
call npm test
if errorlevel 1 (
  echo.
  echo Tests failed. Do NOT commit yet.
  pause
  exit /b 1
)
echo.
echo ============================================================
echo ALL TESTS PASSED - SAFE TO COMMIT v0.5.1
echo ============================================================
pause
