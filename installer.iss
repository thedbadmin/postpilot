; Inno Setup script -> Output\PostPilot-Setup.exe
; Build the app first with build_windows.bat, then open this file in Inno Setup and click Compile.
#define AppName "PostPilot"
#define AppVersion "1.0.0"
#define Publisher "TheDBAdmin"

[Setup]
AppId={{6E4B7C2A-3F1D-4C8E-9A57-2B8D0F1E7C44}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#Publisher}
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
PrivilegesRequired=lowest
OutputBaseFilename=PostPilot-Setup
SetupIconFile=assets\icon.ico
UninstallDisplayIcon={app}\PostPilot.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Files]
Source: "dist\PostPilot\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\PostPilot.exe"
Name: "{userdesktop}\{#AppName}"; Filename: "{app}\PostPilot.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

[Run]
Filename: "{app}\PostPilot.exe"; Description: "Start PostPilot"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{cmd}"; Parameters: "/C reg delete HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v PostPilot /f"; Flags: runhidden; RunOnceId: "RemoveAutostart"
