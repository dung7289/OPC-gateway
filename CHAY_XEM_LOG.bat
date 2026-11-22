@echo off
title Industrial Gateway
echo Dang khoi dong Industrial Gateway...
timeout /t 2 /nobreak >nul
start http://localhost:8000
IndustrialGateway.exe
pause
