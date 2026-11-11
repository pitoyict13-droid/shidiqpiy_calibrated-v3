@echo off
cd /d "%~dp0"
title SnR Monitor - Ctrl+C untuk berhenti
echo ===== live_state.json =====
type bridge\snr\live_state.json 2>nul
echo.
echo ===== live_trades.csv =====
type bridge\snr\live_trades.csv 2>nul
echo.
echo ===== live_features.csv (10 terakhir) =====
powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Test-Path 'bridge\snr\live_features.csv') { Get-Content 'bridge\snr\live_features.csv' -Tail 10 }"
echo.
echo ===== live.log (mengikuti baris baru) =====
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content -Path 'bridge\snr\live.log' -Tail 30 -Wait"
