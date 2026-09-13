@echo off
setlocal enabledelayedexpansion
title KKR Restaurant - Preview
cd /d "%~dp0"

echo ============================================
echo   KKR Restaurant - Language Preview Server
echo ============================================
echo.

rem --- Pick a Python command. "py" is the official Windows launcher and is
rem     far more reliable than "python", which on some Windows PCs is just
rem     a Microsoft Store shortcut that does nothing.
set PYCMD=
where py >nul 2>nul
if %errorlevel%==0 set PYCMD=py
if not defined PYCMD (
    where python >nul 2>nul
    if %errorlevel%==0 set PYCMD=python
)

if not defined PYCMD (
    echo No Python was found on this PC.
    echo.
    echo Please install it from https://python.org/downloads/
    echo ^(tick "Add Python to PATH" during install^), then double-click
    echo this file again.
    echo.
    pause
    exit /b
)

rem --- Find a free port, starting at 8080. This avoids the most common
rem     "it worked before, now it doesn't" problem: a server left running
rem     in another window from an earlier test.
set PORT=8080
:portloop
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul
if %errorlevel%==0 (
    set /a PORT+=1
    if !PORT! GTR 8099 (
        echo Could not find a free port between 8080 and 8099.
        echo Close any old "KKR Restaurant - Preview" windows and try again.
        pause
        exit /b
    )
    goto portloop
)

echo Using %PYCMD% on port %PORT%
echo.
echo   English : http://localhost:%PORT%/en/
echo   Urdu    : http://localhost:%PORT%/ur/
echo   Pashto  : http://localhost:%PORT%/ps/
echo.
echo If a page doesn't load, wait a couple of seconds and refresh -
echo the server needs a moment to start.
echo.
echo Press CTRL+C in this window to stop the server when you're done.
echo (If you close this window without stopping it, re-running this
echo  file later will just pick the next free port automatically.)
echo.

start "" http://localhost:%PORT%/en/
%PYCMD% -m http.server %PORT%
