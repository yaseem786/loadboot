@echo off
REM ============================================================================
REM  Stale git lock files hata kar SIRF named files commit karta hai.
REM
REM  PEHLE GITHUB DESKTOP BAND KAR DEIN — warna wo locks dobara bana dega.
REM
REM  Do cheezein pichli version mein ghalat theen:
REM   1. "git add -A" saara purana kachra bhi utha leta tha, aur commit message
REM      purana YouTube wala hardcoded tha. Ab sirf named files add hoti hain.
REM   2. Plain CMD mein "git" nahi milta — GitHub Desktop apna git bundle karta
REM      hai lekin PATH mein nahi daalta. Ab neeche khud dhoondha jata hai.
REM ============================================================================
setlocal
cd /d "%~dp0"

echo.
echo ==== git dhoondh raha hoon ====
set "GIT="
for %%P in (
  "%ProgramFiles%\Git\cmd\git.exe"
  "%ProgramFiles(x86)%\Git\cmd\git.exe"
  "%LOCALAPPDATA%\Programs\Git\cmd\git.exe"
) do (
  if not defined GIT if exist %%P set "GIT=%%~P"
)
REM GitHub Desktop ka bundled git — folder ka naam version ke saath badalta hai
if not defined GIT (
  for /d %%D in ("%LOCALAPPDATA%\GitHubDesktop\app-*") do (
    if not defined GIT if exist "%%D\resources\app\git\cmd\git.exe" set "GIT=%%D\resources\app\git\cmd\git.exe"
  )
)
if not defined GIT (
  for /d %%D in ("%LOCALAPPDATA%\GitHubDesktop\app-*") do (
    if not defined GIT if exist "%%D\resources\app\git\mingw64\bin\git.exe" set "GIT=%%D\resources\app\git\mingw64\bin\git.exe"
  )
)

if not defined GIT (
  echo   git kahin nahi mila.
  echo.
  echo   Do raaste hain:
  echo     1^) GitHub Desktop kholein aur wahan se commit kar dein — sab se aasan.
  echo     2^) Git for Windows install kar lein: https://git-scm.com/download/win
  echo        Uske baad ye file dobara chalayen.
  echo.
  echo   Locks phir bhi hata deta hoon, taake GitHub Desktop atke nahi.
  goto :cleanlocks
)
echo   mil gaya: %GIT%

:cleanlocks
echo.
echo ==== lock files hata raha hoon ====
for %%F in (
  ".git\index.lock"
  ".git\HEAD.lock"
  ".git\dead.index.lock"
  ".git\dead.HEAD.lock"
  ".git\objects\maintenance.lock"
  ".git\objects\dead.maintenance.lock"
  ".git\refs\heads\feat\dispatcher-model.lock"
) do (
  if exist %%F ( del /f /q %%F && echo   hata diya: %%F )
)
if exist "_to_delete" ( rd /s /q "_to_delete" && echo   _to_delete folder hata diya )
echo   done.

if not defined GIT (
  echo.
  echo Ab GitHub Desktop kholein — wo ab chal jayega.
  pause
  exit /b 0
)

echo.
echo ==== ye files commit hongi ====
"%GIT%" add app/shared/telemetry.js
"%GIT%" add app/command-center/views/agents.js
"%GIT%" add app/command-center/views/radar.js
"%GIT%" add app/command-center/views/partnerIntake.js
"%GIT%" add CLAUDE.md
"%GIT%" status --short --cached
echo.
echo Upar SIRF wohi paanch files honi chahiyen. Agar aur kuch dikhe to
echo is window ko band kar dein aur pehle poochh lein.
echo.
pause

"%GIT%" commit -m "Fix telemetry token leak and seven null-currentTarget handlers" -m "Telemetry scrubbed only the eyJ-prefixed segments of a JWT, so the signature survived; a real Supabase signup callback was captured in production with the token half-readable. Now matches whole JWTs, redacts by parameter name, and masks any long opaque string - client side and in Postgres. Existing rows rewritten through the fixed scrubber. Separately, seven async onClick handlers read ev.currentTarget after awaiting a prompt, by which point it is null - so Reject payout, Approve method, Request details, Decline load, Info needed and Reject agent all threw before their API call and silently did nothing. Element is now captured synchronously."

echo.
echo ==== nateeja ====
"%GIT%" log --oneline -1
echo.
"%GIT%" push
echo.
echo Ho gaya. Netlify khud deploy kar dega.
pause
endlocal
