$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime.ps1')
$setupRoot = Split-Path -Path $PSScriptRoot -Parent
$setupVersion = '22.23.3'
$setupArchitecture = Get-ProjectArchitecture
if ($setupArchitecture -notin @('x64', 'arm64')) {
  throw 'This setup supports Windows x64 and ARM64.'
}
$setupArchiveName = "node-v$setupVersion-win-$setupArchitecture.zip"
$setupRuntimeDirectory = Join-Path $setupRoot ".tools\node-v$setupVersion-win-$setupArchitecture"
$setupNode = Join-Path $setupRuntimeDirectory 'node.exe'
New-Item -ItemType Directory -Path (Join-Path $setupRoot '.tools') -Force | Out-Null
if (-not (Test-Path -LiteralPath $setupNode)) {
  $setupArchive = Join-Path $setupRoot ".tools\$setupArchiveName"
  $setupBaseUrl = "https://nodejs.org/dist/v$setupVersion"
  $setupChecksums = (Invoke-WebRequest -UseBasicParsing -Uri "$setupBaseUrl/SHASUMS256.txt").Content
  $setupChecksumLine = ($setupChecksums -split "`n") | Where-Object { $_.Trim().EndsWith("  $setupArchiveName") }
  if (@($setupChecksumLine).Count -ne 1) { throw 'Could not find the official runtime checksum.' }
  $setupExpectedChecksum = ($setupChecksumLine.Trim() -split '\s+')[0]
  Invoke-WebRequest -UseBasicParsing -Uri "$setupBaseUrl/$setupArchiveName" -OutFile $setupArchive
  $setupActualChecksum = (Get-FileHash -LiteralPath $setupArchive -Algorithm SHA256).Hash
  if ($setupActualChecksum.ToLowerInvariant() -ne $setupExpectedChecksum.ToLowerInvariant()) {
    throw 'Runtime checksum mismatch. The archive was not extracted.'
  }
  Expand-Archive -LiteralPath $setupArchive -DestinationPath (Join-Path $setupRoot '.tools') -Force
}
$setupReportedVersion = & $setupNode --version
if ($setupReportedVersion -ne "v$setupVersion") { throw 'The local runtime version is unexpected.' }
$env:PATH = "$setupRuntimeDirectory;$env:PATH"
$setupNpm = Join-Path $setupRuntimeDirectory 'node_modules\npm\bin\npm-cli.js'
Push-Location $setupRoot
try {
  $setupInstallCommand = if (Test-Path -LiteralPath 'package-lock.json') { 'ci' } else { 'install' }
  & $setupNode $setupNpm $setupInstallCommand --cache (Join-Path $setupRoot 'work\npm-cache') --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
} finally {
  Pop-Location
}
Write-Output "Agree First is ready. Start it with .\scripts\run.ps1 dev"



