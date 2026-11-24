@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install.ps1" -Target VSCode -Uninstall %*
set "status=%ERRORLEVEL%"
if not "%status%"=="0" pause
exit /b %status%
