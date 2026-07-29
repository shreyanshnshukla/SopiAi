@echo off
title Sopi Voice Assistant Launcher
echo ==========================================
echo           STARTING SOPI VOICE AGENT
echo ==========================================
echo.

cd /d "%~dp0"

:: Check for virtual environment
if not exist venv (
    echo [System] Virtual environment not found. Creating one...
    python -m venv venv
    if %errorlevel% neq 0 (
        echo [Error] Failed to create virtual environment. Is Python installed?
        pause
        exit /b %errorlevel%
    )
)

:: Install dependencies
echo [System] Installing/checking dependencies...
call venv\Scripts\pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo [Warning] Some dependencies failed to install. We will attempt to run anyway.
)

:: Start Backend
echo [System] Starting Sopi Backend Server (FastAPI)...
start "Sopi Backend Server" /min venv\Scripts\uvicorn backend.main:app --host 127.0.0.1 --port 8000

:: Wait for server boot
echo [System] Waiting for server to initialize...
timeout /t 3 /nobreak > nul

:: Launch Web UI
echo [System] Launching browser interface...
start http://127.0.0.1:8000

:: Start background voice detector (wake-word)
echo [System] Launching background wake-word listener (Ctrl+C to close)...
call venv\Scripts\python backend/utils/voice_detector.py

pause
