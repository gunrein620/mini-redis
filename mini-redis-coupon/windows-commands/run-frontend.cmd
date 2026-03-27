@echo off
setlocal
cd /d "%~dp0..\frontend"
"%~dp0..\.venv\Scripts\python.exe" -m http.server 3000
