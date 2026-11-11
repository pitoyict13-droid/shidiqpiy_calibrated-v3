@echo off
cd /d "%~dp0"
python scripts\mt5_gui.py %*
if errorlevel 1 pause
