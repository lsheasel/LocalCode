@echo off
setlocal
set "NODE_EXE=%~dp0node\node.exe"
if exist "%NODE_EXE%" (
  "%NODE_EXE%" "%~dp0dist\erpcode.js" %*
) else (
  node "%~dp0dist\erpcode.js" %*
)
