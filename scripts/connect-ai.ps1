param([switch]$Login)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime.ps1')
$aiConnectRoot = Split-Path -Path $PSScriptRoot -Parent
$aiConnectRuntime = Join-Path $aiConnectRoot ".tools\node-v22.23.3-win-$(Get-ProjectArchitecture)"
$aiConnectNode = Join-Path $aiConnectRuntime 'node.exe'
$aiConnectCli = Join-Path $aiConnectRoot '.tools\ast-0.29.0\ast.exe'
if (-not (Test-Path -LiteralPath $aiConnectNode)) { throw 'Run .\scripts\setup.ps1 first.' }
if (-not (Test-Path -LiteralPath $aiConnectCli)) { & (Join-Path $PSScriptRoot 'setup-ai.ps1') }
if ($Login) {
  & $aiConnectCli login --no-browser
  if ($LASTEXITCODE -ne 0) { throw 'Astropods sign-in did not finish. Try .\scripts\connect-ai.ps1 -Login again.' }
}
& $aiConnectNode (Join-Path $PSScriptRoot 'connect-ai.mjs')
exit $LASTEXITCODE
