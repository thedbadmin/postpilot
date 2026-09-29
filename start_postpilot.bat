@echo off
REM PostPilot - first run sets up a private Python environment, later runs just start the app.
cd /d "%~dp0"
if not exist ".venv\Scripts\pythonw.exe" (
    echo Setting up PostPilot for the first time. This takes 1-2 minutes...
    py -3 -m venv .venv || python -m venv .venv
    if errorlevel 1 (
        echo Python was not found. Install Python 3.12 from https://www.python.org/downloads/ and tick "Add python.exe to PATH".
        pause
        exit /b 1
    )
    ".venv\Scripts\python.exe" -m pip install --upgrade pip >nul
    ".venv\Scripts\python.exe" -m pip install -r requirements.txt
    if errorlevel 1 (
        echo Installing packages failed. See the messages above.
        pause
        exit /b 1
    )
)
start "" ".venv\Scripts\pythonw.exe" run.py %*
