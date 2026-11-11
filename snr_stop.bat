@echo off
cd /d "%~dp0"
if not exist bridge\snr\live.pid (
    echo live.pid tidak ada, executor mungkin tidak berjalan.
    pause
    exit /b 1
)
set /p PID=<bridge\snr\live.pid
echo Menghentikan executor PID %PID% ...
taskkill /PID %PID% /F
del bridge\snr\live.pid 2>nul
pause
