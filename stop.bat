@echo off
chcp 65001 >nul
title Dung Industrial Gateway

echo Dang tat cac tien trinh Industrial Gateway...

powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8000, 5173, 4840 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"

echo Da tat thanh cong toan bo Gateway!
pause
