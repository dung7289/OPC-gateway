@echo off
chcp 65001 >nul
title Industrial Gateway - Debug Mode

echo.
echo ============================================================
echo   INDUSTRIAL GATEWAY - RUNNING IN DEBUG MODE
echo ============================================================
echo.

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%frontend"

echo [1] Kiem tra Python...
python --version
echo.

echo [2] Chuyen vao backend: %BACKEND%
cd /d "%BACKEND%"

if not exist "venv\Scripts\activate.bat" (
    echo [2.1] Tao Virtual Environment...
    python -m venv venv
)

echo [2.2] Kich hoat Virtual Environment...
call venv\Scripts\activate.bat

echo [2.3] Nang cap pip, wheel...
python -m pip install --upgrade pip setuptools wheel

echo [2.4] Cai dat thu vien tu requirements.txt...
pip install -r requirements.txt

echo.
echo ============================================================
echo   BAT DAU CHAY THU BACKEND TRUC TIEP TAI DAY...
echo   (Neu co loi se dung lai de ban doc chu khong tat dot ngot)
echo ============================================================
echo.

python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

echo.
echo Backend da dung lai hoac bi crash!
pause
