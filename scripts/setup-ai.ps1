$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime.ps1')
$aiSetupRoot = Split-Path -Path $PSScriptRoot -Parent
$aiSetupNode = Join-Path $aiSetupRoot ".tools\node-v22.23.3-win-$(Get-ProjectArchitecture)\node.exe"
if (-not (Test-Path -LiteralPath $aiSetupNode)) { throw 'Run .\scripts\setup.ps1 first.' }
& $aiSetupNode (Join-Path $PSScriptRoot 'setup-ai.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Astropods setup did not complete.' }
