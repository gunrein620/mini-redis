@echo off
setlocal
cd /d "%~dp0..\mini-redis"
"%~dp0..\.venv\Scripts\python.exe" server.py

