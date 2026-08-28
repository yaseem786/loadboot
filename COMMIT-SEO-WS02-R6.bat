@echo off
REM ============================================================================
REM  build_site.py (workstream 02 + R6) commit + push karta hai.
REM
REM  PEHLE GITHUB DESKTOP BAND KAR DEIN - warna lock files dobara ban jati hain.
REM
REM  Sirf DO named files commit hoti hain. "git add -A" jaan bujh kar nahi use
REM  kiya - wo purana kachra bhi utha leta hai (ye galti pehle ho chuki hai).
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
  echo   Sab se aasan raasta: GitHub Desktop kholein, wahan build_site.py aur
  echo   apply_r6_seo.py par tick lagayen, summary likhein:
  echo       seo: workstream 02 industry pages + R6 title surgery
  echo   phir Commit, phir Push origin.
  echo.
  echo   Locks phir bhi hata deta hoon taake GitHub Desktop atke nahi.
  goto :cleanlocks
)
echo   mil gaya: %GIT%

:cleanlocks
echo.
echo ==== stale lock files hata raha hoon ====
for %%F in (
  ".git\index.lock"
  ".git\HEAD.lock"
  ".git\dead.index.lock"
  ".git\dead.HEAD.lock"
  ".git\objects\maintenance.lock"
) do (
  if exist %%F ( del /f /q %%F && echo   hata diya: %%F )
)
echo   done.

if not defined GIT (
  echo.
  echo Ab GitHub Desktop kholein - wo ab chal jayega.
  pause
  exit /b 0
)

echo.
echo ==== aap is branch par hain ====
"%GIT%" rev-parse --abbrev-ref HEAD
echo.
echo ==== abhi kya badla hua hai ====
"%GIT%" status --short
echo.
echo Upar build_site.py zaroor modified dikhna chahiye.
echo Agar nahi dikh raha to ye window band kar dein aur mujhe batayen.
echo.
pause

echo.
echo ==== sirf ye do files add kar raha hoon ====
"%GIT%" add build_site.py
"%GIT%" add apply_r6_seo.py
"%GIT%" status --short --cached
echo.
echo Upar SIRF ye do files honi chahiyen. Kuch aur dikhe to window band kar dein.
echo.
pause

"%GIT%" commit -m "seo: workstream 02 industry pages + R6 title surgery" -m "Runs the two patch scripts that were committed but never applied, so build_site.py finally carries them. Adds the six {industry}-freight-shipping.html pages plus the freight-shipping-by-industry.html hub, and retitles detention-pay-policy, dry-van-dispatch and power-only-dispatch against live GSC data (all three at 0 clicks with 91-136 impressions). Also removes 'The live table above updates weekly' from market-rates.html - a cadence claim that survived the 25 Aug sweep and was live while rate_benchmarks has not moved since 2026-08-17. Verified: python build_site.py prints BUILD OK."

echo.
echo ==== nateeja ====
"%GIT%" log --oneline -1
echo.
echo ==== push ====
"%GIT%" push
echo.
"%GIT%" rev-parse --abbrev-ref HEAD > "%TEMP%\lb_branch.txt"
set /p LBBRANCH=<"%TEMP%\lb_branch.txt"
del /f /q "%TEMP%\lb_branch.txt" 2>nul
echo.
if /I "%LBBRANCH%"=="main" (
  echo Aap main par thay - Netlify khud deploy kar dega, ~2 minute lagenge.
) else (
  echo ==== DHYAN DEIN ====
  echo Aap "%LBBRANCH%" branch par hain, main par nahi.
  echo Netlify sirf main se deploy karta hai, is liye push kaafi NAHI hai.
  echo GitHub par jayen, is branch se main mein Pull Request banayen aur merge karein
  echo - bilkul waise hi jaise abhi PR #153 kiya tha.
)
echo.
echo Deploy ke baad ye do link kholein ^(?v=1 zaroori hai, warna purana cache aata hai^):
echo   https://loadboot.com/freight-shipping-by-industry.html?v=1
echo   https://loadboot.com/power-only-dispatch.html?v=1
echo.
pause
endlocal
