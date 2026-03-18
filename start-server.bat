@echo off
setlocal

REM Простая команда для запуска статического dev-сервера.
REM Требуется установленный Python.

cd /d "%~dp0"
python -m http.server 9011

