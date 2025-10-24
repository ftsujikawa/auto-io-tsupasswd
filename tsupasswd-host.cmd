@echo off
setlocal
set "TSUPASSWD_BIN=C:\Users\f-tsu\AppData\Local\tsupasswd\tsupasswd.exe"
REM pythonのフルパスが必要なら差し替え
python "%~dp0tsupasswd-host"
endlocal