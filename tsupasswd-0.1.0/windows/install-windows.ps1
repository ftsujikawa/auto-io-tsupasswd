Param(
    [string]$ExtensionId
)

Write-Host "tsupasswd native host installer for Windows" -ForegroundColor Cyan

# If no extension ID was provided as a parameter, ask interactively
if (-not $ExtensionId) {
    $ExtensionId = Read-Host "Enter Chrome extension ID (32 characters)"
}

if (-not $ExtensionId -or $ExtensionId.Length -ne 32) {
    Write-Error "Invalid extension ID. It must be 32 characters."
    exit 1
}

# Resolve script directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Install location in user's profile (no admin required)
$InstallDir = Join-Path $env:LOCALAPPDATA "tsupasswd"
$HostBinarySrc = Join-Path $ScriptDir "tsupasswd-host.cmd"
$CliBinarySrc  = Join-Path $ScriptDir "tsupasswd.exe"
$ManifestTemplateSrc = Join-Path $ScriptDir "dev.happyfactory.tsupasswd-win.json"

if (-not (Test-Path $HostBinarySrc)) {
    Write-Error "Host launcher not found: $HostBinarySrc"
    exit 1
}
if (-not (Test-Path $CliBinarySrc)) {
    Write-Error "CLI binary not found: $CliBinarySrc"
    exit 1
}
if (-not (Test-Path $ManifestTemplateSrc)) {
    Write-Error "Host manifest template not found: $ManifestTemplateSrc"
    exit 1
}

# Create install directory and copy binaries
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null

Copy-Item $HostBinarySrc (Join-Path $InstallDir "tsupasswd-host.cmd") -Force
Copy-Item $CliBinarySrc  (Join-Path $InstallDir "tsupasswd.exe")      -Force

Write-Host "Installed binaries to $InstallDir" -ForegroundColor Green

# Prepare Native Messaging host manifest
$ChromeNativeDir = Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data\NativeMessagingHosts"
New-Item -ItemType Directory -Path $ChromeNativeDir -Force | Out-Null

$HostBinaryPath = Join-Path $InstallDir "tsupasswd-host.cmd"
$ManifestDst = Join-Path $ChromeNativeDir "dev.happyfactory.tsupasswd.json"

# Read template JSON and replace path and extension ID
$manifestJson = Get-Content $ManifestTemplateSrc -Raw

# Escape backslashes for JSON
$escapedPath = $HostBinaryPath.Replace("\", "\\")

$manifestJson = $manifestJson -replace '"path"\s*:\s*"[^"]*"', '"path": ' + '"' + $escapedPath + '"'
$manifestJson = $manifestJson -replace 'chrome-extension://[a-z0-9]{32}/', 'chrome-extension://' + $ExtensionId + '/' 

$manifestJson | Out-File -FilePath $ManifestDst -Encoding UTF8

Write-Host "Installed NativeMessaging manifest to $ManifestDst" -ForegroundColor Green

# Register Native Messaging host in HKCU
$RegPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\dev.happyfactory.tsupasswd'
New-Item -Path $RegPath -Force | Out-Null
Set-ItemProperty -Path $RegPath -Name '(default)' -Value $ManifestDst -Type String

Write-Host "Registered native messaging host in $RegPath" -ForegroundColor Green

Write-Host "" 
Write-Host "Installation completed successfully." -ForegroundColor Cyan
Write-Host "Please restart Chrome completely and then try the tsupasswd extension."
