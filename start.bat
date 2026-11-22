@echo off
chcp 65001 >nul
title Industrial Gateway

echo.
echo  ============================================================
echo   INDUSTRIAL GATEWAY v1.0.0
echo   PLC/IoT Connectivity Platform & OPC-UA Server
echo  ============================================================
echo.

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%frontend"

REM Neu chua cai dat venv, tu dong chay auto_setup.bat
if not exist "%BACKEND%\venv\Scripts\python.exe" (
    echo [THONG BAO] Phat hien chua cai dat tren may nay!
    echo Dang khoi dong bo cai dat tu dong 1-Click...
    call "%ROOT%auto_setup.bat"
)

echo.
echo [1/2] Khoi dong Industrial Gateway & OPC-UA Server...
start "Industrial Gateway Server" "%ROOT%run_backend.bat"

timeout /t 3 /nobreak >nul

echo [2/2] Mo trinh duyet Web UI...
start "" "http://localhost:8000"

echo.
echo  ============================================================
echo   🎉 INDUSTRIAL GATEWAY DA KHOI DONG THANH CONG!
echo.
echo   👉 Giao dien Web : http://localhost:8000
echo   👉 OPC-UA Server : opc.tcp://127.0.0.1:4840/freeopcua/server/
echo   👉 Swagger API   : http://localhost:8000/docs
echo  ============================================================
echo.
echo  Cua so khoi dong nay da xong va se tu dong dong sau 3 giay...
echo  (Gateway van tiep tuc chay tren may cua ban)
timeout /t 3 >nul
exit
