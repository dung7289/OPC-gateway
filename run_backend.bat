@echo off
chcp 65001 >nul
title Industrial Gateway Server - Port 8000
cd /d "%~dp0backend"
if exist "venv\Scripts\activate.bat" call venv\Scripts\activate.bat
echo.
echo  === INDUSTRIAL GATEWAY SERVER running at http://localhost:8000 ===
echo  === OPC-UA SERVER running at opc.tcp://0.0.0.0:4840 ===
echo.
python -m uvicorn main:app --host 0.0.0.0 --port 8000
echo.
echo [CHUY] Server bi dung lai hoac gap loi o tren!
pause
