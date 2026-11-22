@echo off
chcp 65001 >nul
title Frontend - React Vite port 5173
cd /d "%~dp0frontend"
echo.
echo  === FRONTEND REACT running at http://localhost:5173 ===
echo.
npm run dev
echo.
echo [CHUY] Frontend bi dung lai!
pause
