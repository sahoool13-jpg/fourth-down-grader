@echo off
setlocal
cd /d "%~dp0"
echo ==============================================
echo  4TH DOWN v0.5 - Endgame Intelligence
 echo ==============================================
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js, then run this file again.
  pause
  exit /b 1
)
node scripts\apply-v05.mjs
if errorlevel 1 (
  echo.
  echo PATCH FAILED. Nothing else will run.
  pause
  exit /b 1
)
echo.
echo Running tests...
call npm test
if errorlevel 1 (
  echo.
  echo Tests failed. Do NOT commit yet. Send the terminal output to ChatGPT.
  pause
  exit /b 1
)
echo.
echo ==============================================
echo  V0.5 APPLIED AND TESTS PASSED
 echo ==============================================
echo Now open GitHub Desktop, commit, and Push origin.
pause
