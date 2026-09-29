@echo off
REM Builds dist\PostPilot\PostPilot.exe (no Python needed on the user's PC).
REM Then compile installer.iss with Inno Setup (https://jrsoftware.org/isinfo.php) for a Setup.exe.
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (py -3 -m venv .venv || python -m venv .venv)
".venv\Scripts\python.exe" -m pip install -r requirements.txt
".venv\Scripts\python.exe" -m pip install pyinstaller
".venv\Scripts\pyinstaller.exe" --noconfirm --clean --windowed --name PostPilot ^
  --icon assets\icon.ico ^
  --add-data "web;web" --add-data "assets;assets" ^
  --collect-all webview --hidden-import pystray._win32 ^
  --hidden-import keyring.backends.Windows ^
  run.py
if errorlevel 1 (echo Build failed & pause & exit /b 1)
echo.
echo Built: dist\PostPilot\PostPilot.exe
pause
