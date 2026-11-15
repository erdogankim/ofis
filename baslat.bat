@echo off
chcp 65001 >nul
title Mustafa Dijital Ajan Ofisi (Port 4747)
cd /d "D:\ofis"
echo ====================================================
echo   Mustafa Dijital Ajan Ofisi Baslatiliyor...
echo   Adres: http://localhost:4747
echo ====================================================
start "" "http://localhost:4747"
node server.js
pause
