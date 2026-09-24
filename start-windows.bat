@echo off
setlocal
cd /d "%~dp0"
echo.
echo ========================================
echo   4TH DOWN v0.2 - NFL Decision Grader
echo ========================================
echo.
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo Node.js is not installed on this PC.
  echo.
  echo Please install Node.js 20 or newer from:
  echo https://nodejs.org/
  echo.
  echo After installing it, double-click this file again.
  pause
  exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODEVER=%%i
echo Found Node.js %NODEVER%
echo Starting 4TH DOWN v0.2...
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000"
node server.js
pause
