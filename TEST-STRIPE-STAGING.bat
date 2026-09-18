@echo off
setlocal
REM ============================================================
REM  TEST-STRIPE-STAGING.bat - staging-bound local build + Command Center server.
REM
REM  Local builds are STAGING-bound by design (audit F07): without LOADBOOT_CONTEXT
REM  =production this can never point at real carriers. The anon key below is the
REM  staging project's PUBLIC key - the same one every browser gets - not a secret.
REM ============================================================
cd /d "%~dp0"

set "LOADBOOT_STAGING_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNuc2xodm1ranVzb3pnamVsZ2hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2MTkzMDEsImV4cCI6MjA5ODE5NTMwMX0.-AbYfSWkzHemeGx43JyXktIcpeUiC-Ls_isFA-VDX_c"

echo ==== staging build ====
python build_site.py
if errorlevel 1 (
  echo.
  echo BUILD FAIL - upar ki error copy kar ke Claude ko bhej dein.
  pause
  exit /b 1
)
echo.
findstr /c:"snslhvmkjusozgjelghi" site\app\env-config.js >nul
if errorlevel 1 (
  echo env-config.js staging ki taraf NAHI hai - ruk jayein aur Claude ko batayein.
  pause
  exit /b 1
)
echo   env-config.js -> STAGING  ^(sahi^)
echo.
echo ==== servers ====
start "LB 8083 command-center (staging)" cmd /k python scripts\dev_server.py 8083
start "LB 8080 carrier (staging)" cmd /k python scripts\dev_server.py 8080
timeout /t 2 >nul
start "" "http://localhost:8083/app/command-center/"
echo.
echo Command Center: http://localhost:8083/app/command-center/
echo Carrier portal: http://localhost:8080/app/carrier/
echo.
echo Dono STAGING database se jude hain - yahan jo bhi karein, asli carriers par asar nahi.
echo Server band karne ke liye un do windows ko close kar dein.
pause
endlocal
