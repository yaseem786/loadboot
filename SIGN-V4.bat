@echo off
setlocal
REM ============================================================
REM  SIGN-V4.bat - Android app v1.0.3 (versionCode 4) ko upload
REM  key se sign karta hai. Keystore aur password aap ke computer
REM  se bahar nahi jate. Output: release\loadboot-v4.aab
REM ============================================================
cd /d "%~dp0"
set "FP=A7:F2:AA:FE:A3:00:CE:25:43:BD:5D:F0:E1:9D:17:97:73:51:4D:B7:34:2A:7B:78:26:94:2F:3C:EE:91:F1:48"
echo ==================================================
echo   LoadBoot - app v1.0.3 sign
echo ==================================================
echo.

REM ---- 1. files check -------------------------------------------------
if not exist "release\loadboot-v4-unsigned.aab" (
  echo [X] release\loadboot-v4-unsigned.aab nahi mili.
  echo     GitHub Desktop mein branch claude/stoic-mccarthy-axu76f main mein merge ki?
  goto :end
)
if not exist "loadboot-upload.keystore" (
  echo [X] loadboot-upload.keystore is folder mein nahi mili:
  echo     %CD%
  echo     Keystore file yahan copy karein, phir dobara chalayen.
  goto :end
)
echo [OK] AAB aur keystore mil gaye.

REM ---- 2. jarsigner / keytool dhoondo ---------------------------------
call :findjava
if not defined JBIN (
  echo.
  echo [!] Java ^(jarsigner^) is computer par nahi mila.
  echo     Ab Java install karta hoon ^(Microsoft winget se, free, ~200 MB^).
  echo     Koi Windows popup aaye to "Yes" dabayen.
  echo.
  winget install -e --id EclipseAdoptium.Temurin.21.JDK --accept-package-agreements --accept-source-agreements
  call :findjava
)
if not defined JBIN (
  echo.
  echo [X] Java ab bhi nahi mila. Is window ki photo Claude ko bhej dein.
  goto :end
)
echo [OK] Java: %JBIN%

REM ---- 3. password -----------------------------------------------------
set "SP="
if exist "PLAY-KEYSTORE-NOTE.txt" (
  for /f "tokens=1,* delims= " %%A in ('findstr /b /c:"Password: " "PLAY-KEYSTORE-NOTE.txt"') do set "SP=%%B"
)
copy /y "release\loadboot-v4-unsigned.aab" "release\loadboot-v4.aab" >nul
echo.
if defined SP (
  echo [OK] Password PLAY-KEYSTORE-NOTE.txt se le liya. Sign ho raha hai...
  "%JBIN%\jarsigner.exe" -keystore loadboot-upload.keystore -storepass:env SP -digestalg SHA-256 -sigalg SHA256withRSA "release\loadboot-v4.aab" loadboot >nul
) else (
  echo Keystore ka password type karein ^(type karte waqt dikhega nahi^), phir Enter:
  "%JBIN%\jarsigner.exe" -keystore loadboot-upload.keystore -digestalg SHA-256 -sigalg SHA256withRSA "release\loadboot-v4.aab" loadboot
)
if errorlevel 1 (
  set "SP="
  echo.
  echo [X] Sign nahi hua ^(password galat?^). Dobara chalayen.
  del "release\loadboot-v4.aab" >nul 2>&1
  goto :end
)
set "SP="

REM ---- 4. verify: sahi key se sign hua? -------------------------------
"%JBIN%\keytool.exe" -printcert -jarfile "release\loadboot-v4.aab" | findstr /c:"%FP%" >nul
if errorlevel 1 (
  echo.
  echo [X] GALAT key se sign hua - yeh file Play par upload NA karein.
  del "release\loadboot-v4.aab" >nul 2>&1
  goto :end
)
echo.
echo ==================================================
echo   [OK] TAYYAR: release\loadboot-v4.aab
echo   Upload key sahi hai (A7:F2 ... F1:48).
echo   Ab yeh file Play Console par upload karein.
echo ==================================================
explorer /select,"%CD%\release\loadboot-v4.aab"
goto :end

:findjava
set "JBIN="
for %%X in (jarsigner.exe) do if not "%%~$PATH:X"=="" set "JBIN=%%~dp$PATH:X"
if defined JBIN if "%JBIN:~-1%"=="\" set "JBIN=%JBIN:~0,-1%"
if not defined JBIN if defined JAVA_HOME if exist "%JAVA_HOME%\bin\jarsigner.exe" set "JBIN=%JAVA_HOME%\bin"
if not defined JBIN if exist "%ProgramFiles%\Android\Android Studio\jbr\bin\jarsigner.exe" set "JBIN=%ProgramFiles%\Android\Android Studio\jbr\bin"
for /d %%D in ("%ProgramFiles%\Eclipse Adoptium\*" "%ProgramFiles%\Java\*" "%ProgramFiles%\Microsoft\jdk-*" "%ProgramFiles%\Zulu\*") do (
  if not defined JBIN if exist "%%~D\bin\jarsigner.exe" set "JBIN=%%~D\bin"
)
exit /b 0

:end
echo.
pause
