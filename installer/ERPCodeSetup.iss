[Setup]
AppName=ERPCode
AppVersion=0.1.0
DefaultDirName={autopf}\ERPCode
DefaultGroupName=ERPCode
OutputBaseFilename=ERPCodeSetup
Compression=lzma
SolidCompression=yes
WizardStyle=modern

[Files]
Source: "..\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Run]
Filename: "{cmd}"; Parameters: "/c node --version"; WorkingDir: "{app}"; StatusMsg: "Finalizing..."; Flags: runhidden

[Icons]
Name: "{group}\ERPCode"; Filename: "{app}\erpcode.cmd"

[Registry]
Root: HKLM; Subkey: "SYSTEM\CurrentControlSet\Control\Session Manager\Environment"; ValueType: expandsz; ValueName: "Path"; ValueData: "{olddata};{app}"; Check: NeedsAddPath

[Code]
function NeedsAddPath(): Boolean;
var
  OrigPath: string;
begin
  if not RegQueryStringValue(HKLM, 'SYSTEM\CurrentControlSet\Control\Session Manager\Environment', 'Path', OrigPath) then begin
    Result := True;
    exit;
  end;
  Result := Pos(Uppercase(ExpandConstant('{app}')), Uppercase(OrigPath)) = 0;
end;
