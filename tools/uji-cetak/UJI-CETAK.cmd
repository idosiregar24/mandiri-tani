@echo off
rem Klik dua kali file ini untuk uji cetak Epson LX-310 (semua halaman).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uji-cetak-lx310.ps1" %*
echo.
pause
