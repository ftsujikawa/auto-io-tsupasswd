@echo off
setlocal
set "TSUPASSWD_BIN=C:\Users\f-tsu\AppData\Local\tsupasswd\tsupasswd.exe"
REM pythonのフルパスが必要なら差し替え
"C:\Users\f-tsu\AppData\Local\Python\bin\python.exe" "%~dp0tsupasswd-host"
endlocal