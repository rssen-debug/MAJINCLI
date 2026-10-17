@echo off
rem ============================================================
rem  LENT — starta agenten på Windows (dubbelklicka den här)
rem  Agenten körs i Node; fönstret är ett Edge-app-fönster.
rem ============================================================
setlocal EnableExtensions
title LENT
if "%LENT_HOME%"=="" set "LENT_HOME=%LOCALAPPDATA%\LENT"
set "LENT_CONFIG="
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   LENT behover Node 20.11 eller senare.
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
echo   Node %NODEV% ar for gammal for LENT (kraver 20.11+).
echo   hamta ny: https://nodejs.org/   eller   winget install OpenJS.NodeJS.LTS
echo.
pause
exit /b 1

:run
echo.
echo   LENT 0.1.0 · data: %LENT_HOME%
echo   (Ctrl+C stoppar agenten. For fonsk utan start: lent start --no-window)
echo.
node "src\cli\lent.js" start %*
if errorlevel 1 (
  echo.
  echo   LENT avslutade med fel. Kor sjalvtest:
  node "src\cli\lent.js" doctor
  echo.
  pause
)
endlocal
