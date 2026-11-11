@echo off
cd /d "%~dp0"
title SnR Live - XAUUSD C1 (DEMO)
set PYTHONPATH=scripts
python -u scripts\snr_live.py --enable --risk-usd 45 %*
if errorlevel 1 pause
