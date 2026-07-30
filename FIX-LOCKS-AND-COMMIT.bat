@echo off
REM Stale git lock files hata kar commit karta hai.
REM PEHLE GITHUB DESKTOP BAND KAR DEIN, warna wo locks dobara bana dega.
cd /d "%~dp0"
echo.
echo ==== lock files hata raha hoon ====
if exist ".git\index.lock" del /f /q ".git\index.lock" && echo   index.lock hata diya
if exist ".git\HEAD.lock"  del /f /q ".git\HEAD.lock"  && echo   HEAD.lock hata diya
if exist ".git\refs\heads\feat\dispatcher-model.lock" del /f /q ".git\refs\heads\feat\dispatcher-model.lock"
echo.
echo ==== jo commit hone ja raha hai ====
git status --short
echo.
pause
git add -A
git commit -m "YouTube launch: detention explainer + on-site player with chapters, captions and VideoObject schema; four-audience SEO links; docs/youtube packs; tools/video render pipeline"
echo.
echo ==== nateeja ====
git log --oneline -1
echo.
git status --short
echo.
echo Commit ho gaya to ab GitHub Desktop kholein aur "Push origin" dabayen.
echo (ya yahan chalayen:  git push)
echo.
pause
