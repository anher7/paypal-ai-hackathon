param(
  [ValidateSet('dev', 'build', 'test', 'test:e2e', 'typecheck', 'start')]
  [string]$Command = 'dev'
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime.ps1')
$runRoot = Split-Path -Path $PSScriptRoot -Parent
$runArchitecture = Get-ProjectArchitecture
$runRuntimeDirectory = Join-Path $runRoot ".tools\node-v22.23.3-win-$runArchitecture"
$runNode = Join-Path $runRuntimeDirectory 'node.exe'
if (-not (Test-Path -LiteralPath $runNode)) { throw 'Run .\scripts\setup.ps1 first.' }
$env:PATH = "$runRuntimeDirectory;$env:PATH"
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $runRoot '.tools\playwright'
$runNpm = Join-Path $runRuntimeDirectory 'node_modules\npm\bin\npm-cli.js'
Push-Location $runRoot
try {
  & $runNode $runNpm run $Command
  exit $LASTEXITCODE
} finally {
  Pop-Location
}



