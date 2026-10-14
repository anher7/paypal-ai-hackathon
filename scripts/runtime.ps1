function Get-ProjectArchitecture {
  $processorArchitecture = [Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITEW6432')
  if ([string]::IsNullOrWhiteSpace($processorArchitecture)) {
    $processorArchitecture = [Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITECTURE')
  }
  if ([string]::IsNullOrWhiteSpace($processorArchitecture)) {
    throw 'Windows architecture could not be detected. Use a Windows x64 or ARM64 terminal.'
  }
  switch ($processorArchitecture.Trim()) {
    'AMD64' { return 'x64' }
    'ARM64' { return 'arm64' }
    default { throw 'This setup supports Windows x64 and ARM64.' }
  }
}

