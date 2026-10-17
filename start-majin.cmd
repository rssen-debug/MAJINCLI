@echo off
rem ============================================================
rem  MAJIN — starta agenten på Windows (dubbelklicka den här)
rem  Agenten körs i Node; fönstret är ett Edge-app-fönster.
rem ============================================================
setlocal EnableExtensions
title MAJIN
if "%MAJIN_HOME%"=="" set "MAJIN_HOME=%LOCALAPPDATA%\MAJIN"
set "MAJIN_CONFIG="
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   MAJIN behover Node 20.11 eller senare.
  echo   Installera med:  winget install OpenJS.NodeJS.LTS
  echo   Stang detta fonster, oppna ett nytt och kora igen.
  echo.
  pause
  exit /b 1
)

for /f "usebackq tokens=1 delims=" %%v in (`node -v`) do set "NODEV=%%v"
set "NODEV=%NODEV:v=%"
for /f "tokens=1,2 delims=." %%a in ("%NODEV%") do (
  set "MAJOR=%%a"
  set "MINOR=%%b"
)
if %MAJOR% LSS 20 goto :toogame
if %MAJOR% EQU 20 if %MINOR% LSS 11 goto :toogame
goto :run

:toogame
echo.
echo   Node %NODEV% ar for gammal for MAJIN (kraver 20.11+).
echo   hamta ny: https://nodejs.org/   eller   winget install OpenJS.NodeJS.LTS
echo.
pause
exit /b 1

:run
echo.
echo   MAJIN 0.1.0 · data: %MAJIN_HOME%
echo   (Ctrl+C stoppar agenten. For fonsk utan start: majin start --no-window)
echo.
node "src\cli\majin.js" start %*
if errorlevel 1 (
  echo.
  echo   MAJIN avslutade med fel. Kor sjalvtest:
  node "src\cli\majin.js" doctor
  echo.
  pause
)
endlocal
