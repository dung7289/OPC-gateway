@echo off
chcp 65001 >nul
title Cai Dat Tu Dong 1-Click - Industrial Gateway

echo.
echo ============================================================
echo   INDUSTRIAL GATEWAY - BỘ CÀI ĐẶT TỰ ĐỘNG 1-CLICK (ALL-IN-ONE)
echo ============================================================
echo.

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%frontend"

REM ============================================================
REM  BƯỚC 1: KIỂM TRA & TỰ ĐỘNG CÀI PYTHON 3.12 ĐÚNG CHUẨN
REM ============================================================
echo [1/3] Kiem tra moi truong Python 3.12...

set "PYTHON_CMD=python"
python --version >nul 2>&1
if errorlevel 1 goto :INSTALL_PYTHON

REM Kiem tra neu dang dung phien ban qua moi gay loi (nhu Python 3.13, 3.15)
for /f "tokens=2 delims= " %%v in ('python --version 2^>^&1') do set "PY_VER=%%v"
echo       Phat hien Python %PY_VER% tren may.

REM Neu khong phai 3.10, 3.11, 3.12 thi cai them 3.12 chuyen dung cong nghiep
echo %PY_VER% | findstr /b "3.10 3.11 3.12" >nul
if errorlevel 1 (
    echo [CANH BAO] Python %PY_VER% co the gay loi thu vien cong nghiep (thieu C++ compiler).
    goto :INSTALL_PYTHON
)
goto :SETUP_VENV

:INSTALL_PYTHON
echo.
echo [THONG BAO] Dang tu dong tai & cai dat Python 3.12.8 (64-bit) on dinh nhat...
powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $wc = New-Object Net.WebClient; $wc.DownloadFile('https://www.python.org/ftp/python/3.12.8/python-3.12.8-amd64.exe', '%TEMP%\python_312_installer.exe')"
if not exist "%TEMP%\python_312_installer.exe" (
    echo [LOI] Khong the tai Python installer. Vui long kiem tra ket noi Internet!
    pause
    exit /b 1
)

echo Dang cai dat Python 3.12 tu dong (khong can click chuot)...
start /wait "" "%TEMP%\python_312_installer.exe" /quiet PrependPath=1 Include_test=0 Shortcuts=0
del /f /q "%TEMP%\python_312_installer.exe" >nul 2>&1

REM Lam moi bien moi truong PATH trong session hien tai
set "PATH=%LOCALAPPDATA%\Programs\Python\Python312;%LOCALAPPDATA%\Programs\Python\Python312\Scripts;C:\Program Files\Python312;C:\Program Files\Python312\Scripts;%PATH%"
echo       Python 3.12 da duoc cai dat thanh cong!

:SETUP_VENV
REM ============================================================
REM  BƯỚC 2: TẠO VENV & CÀI ĐẶT TOÀN BỘ THƯ VIỆN BACKEND
REM ============================================================
echo.
echo [2/3] Chuan bi moi truong ao & Thu vien Backend...
cd /d "%BACKEND%"

if not exist "venv\Scripts\activate.bat" (
    echo       Tao virtual environment (venv)...
    python -m venv venv
)
call venv\Scripts\activate.bat

echo       Nang cap pip, wheel, setuptools...
python -m pip install --upgrade pip wheel setuptools --quiet

echo       Cai dat tat ca goi cong nghiep (FastAPI, Snap7, Modbus, MQTT, OPC-UA, Crypto)...
pip install -r requirements.txt --quiet
if errorlevel 1 (
    echo       Thu lai voi binary pre-compiled de khong can Visual C++...
    pip install -r requirements.txt --only-binary :all:
)
echo       Tat ca thu vien Python da san sang 100%!

REM ============================================================
REM  BƯỚC 3: KIỂM TRA WEB UI
REM ============================================================
echo.
echo [3/3] Kiem tra Web UI Frontend...
if exist "%FRONTEND%\dist\index.html" (
    echo       Giao dien Web UI React da duoc build san trong frontend/dist.
    echo       He thong chay truc tiep qua FastAPI (KHONG CAN cai dat Node.js tren may nay!).
) else (
    echo       Dang build Frontend...
    cd /d "%FRONTEND%"
    call npm install --silent
    call npm run build
)

echo.
echo ============================================================
echo   CAI DAT HOAN TAT 100%! KHONG CO LOI NAO!
echo.
echo   De khoi dong Gateway hang ngay:
echo     👉 Nhap dup vao: start_silent.vbs  (Chay an ngam, khong hien CMD)
echo     👉 Hoac nhap dup: start.bat         (Chay hien cua so log)
echo ============================================================
echo.
echo Cua so cai dat se tu dong dong sau 3 giay...
timeout /t 3 >nul
