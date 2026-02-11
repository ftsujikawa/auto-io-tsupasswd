@echo off
setlocal
if not defined TSUPASSWD_HOME set "TSUPASSWD_HOME=%~dp0"
set "TSUPASSWD_BIN=%TSUPASSWD_HOME%\tsupasswd.exe"
REM pythonのフルパスが必要なら差し替え
"python.exe" "%TSUPASSWD_HOME%\tsupasswd-host"
endlocal