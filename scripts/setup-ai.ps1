$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime.ps1')
$aiSetupRoot = Split-Path -Path $PSScriptRoot -Parent
$aiSetupVersion = '0.29.0'
$aiSetupArchitecture = Get-ProjectArchitecture
$aiSetupBinaryName = if ($aiSetupArchitecture -eq 'x64') { 'ast-windows-amd64.exe' } else { 'ast-windows-arm64.exe' }
$aiSetupChecksum = if ($aiSetupArchitecture -eq 'x64') {
  'f6ceeade48f46fb41d1f9529b0416c70ffd3462a925f62fd10f4073e314dc945'
} else {
  '17b7f6fdf0027525451585f86526d9d3000bf57d8e3f3ae72a891d7ff4f4d830'
}
$aiSetupDirectory = Join-Path $aiSetupRoot ".tools\ast-$aiSetupVersion"
$aiSetupExecutable = Join-Path $aiSetupDirectory 'ast.exe'
New-Item -ItemType Directory -Path $aiSetupDirectory -Force | Out-Null
if (-not (Test-Path -LiteralPath $aiSetupExecutable)) {
  $aiSetupBaseUrl = 'https://download.astropods.ai/latest'
  $aiSetupRelease = (Invoke-WebRequest -UseBasicParsing -Uri "$aiSetupBaseUrl/VERSION").Content
  if ($aiSetupRelease -is [byte[]]) { $aiSetupRelease = [Text.Encoding]::UTF8.GetString($aiSetupRelease) }
  if ($aiSetupRelease.Trim() -ne $aiSetupVersion) { throw 'The Astropods release changed. Update the pinned setup version and checksums first.' }
  $aiSetupPublishedChecksums = (Invoke-WebRequest -UseBasicParsing -Uri "$aiSetupBaseUrl/checksums.txt").Content
  if ($aiSetupPublishedChecksums -is [byte[]]) { $aiSetupPublishedChecksums = [Text.Encoding]::UTF8.GetString($aiSetupPublishedChecksums) }
  $aiSetupChecksumLine = @($aiSetupPublishedChecksums -split '\r?\n' | Where-Object { $_.Trim().EndsWith("  $aiSetupBinaryName") })
  if ($aiSetupChecksumLine.Count -ne 1 -or ($aiSetupChecksumLine[0].Trim() -split '\s+')[0] -ne $aiSetupChecksum) {
    throw 'The official Astropods checksum differs from the pinned release. Nothing was installed.'
  }
  $aiSetupDownload = Join-Path $aiSetupDirectory 'ast.download'
  try {
    Invoke-WebRequest -UseBasicParsing -Uri "$aiSetupBaseUrl/$aiSetupBinaryName" -OutFile $aiSetupDownload
    if ((Get-FileHash -LiteralPath $aiSetupDownload -Algorithm SHA256).Hash.ToLowerInvariant() -ne $aiSetupChecksum) {
      throw 'Astropods checksum verification failed. The download was not installed.'
    }
    Move-Item -LiteralPath $aiSetupDownload -Destination $aiSetupExecutable -Force
  } finally {
    if (Test-Path -LiteralPath $aiSetupDownload) { Remove-Item -LiteralPath $aiSetupDownload -Force }
  }
}
if ((Get-FileHash -LiteralPath $aiSetupExecutable -Algorithm SHA256).Hash.ToLowerInvariant() -ne $aiSetupChecksum) {
  throw 'The project-local Astropods executable has an unexpected checksum.'
}
$aiSetupReportedVersion = & $aiSetupExecutable --version
if ($LASTEXITCODE -ne 0 -or $aiSetupReportedVersion -notmatch '0\.29\.0') { throw 'The project-local Astropods version is unexpected.' }
Write-Output "Astropods $aiSetupVersion is installed inside this project. Connect it with .\scripts\connect-ai.ps1 -Login"
