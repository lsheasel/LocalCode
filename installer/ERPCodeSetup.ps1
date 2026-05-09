param(
  [string]$InstallDir = "$env:ProgramFiles\ERPCode",
  [switch]$AllUsers
)

$ErrorActionPreference = "Stop"

function Ensure-Admin {
  $current = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $current.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Administrator rights required. Please run PowerShell as Administrator."
  }
}

function Ensure-Node {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    throw "Node.js not found. Please install Node.js 18+ first."
  }
}

function Ensure-Npm {
  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if (-not $npm) {
    throw "npm not found. Please install Node.js which includes npm."
  }
}

function Ensure-Path {
  param([string]$TargetDir, [switch]$System)
  $pathKey = "HKLM:\System\CurrentControlSet\Control\Session Manager\Environment"
  if (-not $System) { $pathKey = "HKCU:\Environment" }

  $current = (Get-ItemProperty -Path $pathKey -Name Path -ErrorAction SilentlyContinue).Path
  if (-not $current) { $current = "" }
  $parts = $current -split ";" | Where-Object { $_ -ne "" }
  if ($parts -notcontains $TargetDir) {
    $newValue = ($parts + $TargetDir) -join ";"
    Set-ItemProperty -Path $pathKey -Name Path -Value $newValue
  }
}

if ($AllUsers) { Ensure-Admin }
Ensure-Node
Ensure-Npm

$repoRoot = Resolve-Path ".."

if (-not (Test-Path -LiteralPath $InstallDir)) {
  New-Item -ItemType Directory -Path $InstallDir | Out-Null
}

Write-Host "Copying files to $InstallDir ..."
Copy-Item -Path (Join-Path $repoRoot "dist") -Destination $InstallDir -Recurse -Force
Copy-Item -Path (Join-Path $repoRoot "package.json") -Destination $InstallDir -Force
Copy-Item -Path (Join-Path $repoRoot "installer\erpcode.cmd") -Destination $InstallDir -Force

Write-Host "Installing production dependencies ..."
Push-Location $InstallDir
npm install --omit=dev | Out-Null
Pop-Location

if ($AllUsers) {
  Ensure-Path -TargetDir $InstallDir -System
} else {
  Ensure-Path -TargetDir $InstallDir
}

Write-Host "ERPCode installed to $InstallDir"
Write-Host "Open a new terminal and run: erpcode"
