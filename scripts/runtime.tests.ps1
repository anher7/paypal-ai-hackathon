$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime.ps1')
$originalProcessorArchitecture = [Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITECTURE')
$originalWow64Architecture = [Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITEW6432')
$architectureCases = @(
  @{ Name = 'x64'; Processor = 'AMD64'; Wow64 = $null; Expected = 'x64' },
  @{ Name = 'ARM64'; Processor = 'ARM64'; Wow64 = $null; Expected = 'arm64' },
  @{ Name = 'WOW64 on x64'; Processor = 'x86'; Wow64 = 'AMD64'; Expected = 'x64' },
  @{ Name = 'emulation on ARM64'; Processor = 'AMD64'; Wow64 = 'ARM64'; Expected = 'arm64' },
  @{ Name = 'lowercase'; Processor = 'amd64'; Wow64 = $null; Expected = 'x64' },
  @{ Name = 'empty WOW64 fallback'; Processor = 'ARM64'; Wow64 = ' '; Expected = 'arm64' },
  @{ Name = 'unsupported x86'; Processor = 'x86'; Wow64 = $null; Expected = $null },
  @{ Name = 'missing architecture'; Processor = $null; Wow64 = $null; Expected = $null }
)
try {
  foreach ($architectureCase in $architectureCases) {
    [Environment]::SetEnvironmentVariable('PROCESSOR_ARCHITECTURE', $architectureCase.Processor, 'Process')
    [Environment]::SetEnvironmentVariable('PROCESSOR_ARCHITEW6432', $architectureCase.Wow64, 'Process')
    $detectedArchitecture = $null
    $architectureError = $null
    try { $detectedArchitecture = Get-ProjectArchitecture } catch { $architectureError = $_ }
    if ($null -eq $architectureCase.Expected) {
      if ($null -eq $architectureError) { throw "Expected a clear error for $($architectureCase.Name)." }
      if ($architectureError.Exception.Message -notmatch 'architecture|x64 and ARM64') {
        throw "Unexpected error for $($architectureCase.Name): $architectureError"
      }
    } elseif ($architectureError -or $detectedArchitecture -ne $architectureCase.Expected) {
      throw "Architecture mismatch for $($architectureCase.Name)."
    }
    Write-Output "PASS: $($architectureCase.Name)"
  }
} finally {
  [Environment]::SetEnvironmentVariable('PROCESSOR_ARCHITECTURE', $originalProcessorArchitecture, 'Process')
  [Environment]::SetEnvironmentVariable('PROCESSOR_ARCHITEW6432', $originalWow64Architecture, 'Process')
}
Write-Output "8 architecture checks passed on PowerShell $($PSVersionTable.PSVersion)."

