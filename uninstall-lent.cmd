@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File ".\install.ps1" -Uninstall
echo.
echo   Data (config, minnen, sessioner) ligger kvar i %LOCALAPPDATA%\LENT
echo   Radera sjalv om du vill:  rmdir /s /q "%LOCALAPPDATA%\LENT"
pause
