@echo off
REM One-click: commit + push the YouTube launch work.
REM Written this way because a multi-line -m message breaks in cmd.exe.
cd /d "%~dp0"
echo.
echo ==== what will be committed ====
git status --short
echo.
pause
git add .
git commit -m "YouTube launch: detention explainer + on-site player with chapters, captions and VideoObject schema; four-audience SEO links; docs/youtube packs; tools/video render pipeline"
echo.
echo ==== pushing ====
git push
echo.
echo ==== result ====
git log --oneline -1
git status --short
echo.
echo If the push succeeded, wait ~2 minutes then open:
echo   https://loadboot.com/detention-pay-policy.html
echo and look for the section "Detention pay that actually gets paid".
echo.
pause
