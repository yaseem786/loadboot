@echo off
setlocal
REM ============================================================
REM  CHECK-TOOLS.bat - dekhta hai ke Stripe deploy ke liye kya
REM  kya mojood hai. Kuch install nahi karta, sirf batata hai.
REM ============================================================
cd /d "%~dp0"
echo ==================================================
echo   LoadBoot - deploy tools check
echo ==================================================
echo.

echo [1] Node.js
where node >nul 2>&1 && ( node --version ) || ( echo    NAHI mila )
echo.

echo [2] npm / npx
where npx >nul 2>&1 && ( npx --version ) || ( echo    NAHI mila )
echo.

echo [3] Supabase CLI ^(PATH mein^)
where supabase >nul 2>&1 && ( supabase --version ) || ( echo    NAHI mila )
echo.

echo [4] Supabase CLI ^(npx ke zariye - thora waqt le sakta hai^)
where npx >nul 2>&1 && ( npx --yes supabase@latest --version 2>nul || echo    npx se bhi nahi chala ) || ( echo    npx nahi hai, skip )
echo.

echo [5] Scoop / Chocolatey ^(install ke liye kaam aate hain^)
where scoop >nul 2>&1 && ( echo    scoop mojood hai ) || ( echo    scoop nahi )
where choco >nul 2>&1 && ( echo    choco mojood hai ) || ( echo    choco nahi )
echo.

echo [6] Git ^(GitHub Desktop ka bundled^)
set "GIT="
for /d %%D in ("%LOCALAPPDATA%\GitHubDesktop\app-*") do (
  if not defined GIT if exist "%%D\resources\app\git\cmd\git.exe" set "GIT=%%D\resources\app\git\cmd\git.exe"
)
if defined GIT (
  "%GIT%" --no-pager rev-parse --abbrev-ref HEAD
  "%GIT%" --no-pager log --oneline -1
) else ( echo    git nahi mila )
echo.

echo ==================================================
echo   Ye poora output copy kar ke Claude ko bhej dein.
echo ==================================================
pause
endlocal
