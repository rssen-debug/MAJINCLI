@echo off
rem LENT — bogyttan: lent.bat doctor / lent.bat send "..." / lent.bat re fil.exe
setlocal
if "%LENT_HOME%"=="" set "LENT_HOME=%LOCALAPPDATA%\LENT"
cd /d "%~dp0"
node "src\cli\lent.js" %*
endlocal
