@echo off
setlocal
cd /d "%~dp0..\backend"
"%~dp0..\.venv\Scripts\python.exe" server.py

