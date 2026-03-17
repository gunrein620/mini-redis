@echo off
setlocal

set "BASE_DIR=%~dp0"
set "VENV_PY=%BASE_DIR%.venv\Scripts\python.exe"
set "PG_SERVICE=postgresql-x64-16"
set "WIN_CMD_DIR=%BASE_DIR%windows-commands\"

echo === Mini Redis Coupon Windows Start ===

if not exist "%VENV_PY%" (
    echo [ERROR] Python virtual environment not found: "%VENV_PY%"
    echo Create it first or install dependencies before running this script.
    exit /b 1
)

sc query "%PG_SERVICE%" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    sc query "%PG_SERVICE%" | find "RUNNING" >nul 2>&1
    if not %ERRORLEVEL% EQU 0 (
        echo [INFO] Starting PostgreSQL service "%PG_SERVICE%"...
        net start "%PG_SERVICE%" >nul 2>&1
    )
)

call :check_port 6379 "Mini Redis"
if errorlevel 1 exit /b 1

call :check_port 8000 "Backend API"
if errorlevel 1 exit /b 1

call :check_port 3000 "Frontend"
if errorlevel 1 exit /b 1

echo [1/3] Starting Mini Redis on port 6379...
start "Mini Redis" "%WIN_CMD_DIR%run-mini-redis.cmd"

echo [2/3] Starting Backend API on port 8000...
start "Backend API" "%WIN_CMD_DIR%run-backend.cmd"

echo [3/3] Starting Frontend on port 3000...
start "Frontend" "%WIN_CMD_DIR%run-frontend.cmd"

echo.
echo All start commands have been launched.
echo   - Mini Redis: http://localhost:6379/health
echo   - Backend:    http://localhost:8000/health
echo   - Frontend:   http://localhost:3000
exit /b 0

:check_port
set "PORT=%~1"
set "LABEL=%~2"
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [ERROR] Port %PORT% is already in use. %LABEL% cannot start.
    echo Close the existing process or free the port, then run this script again.
    exit /b 1
)
exit /b 0
