Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-BoundedNativeText {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$FilePath,
    [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$Arguments,
    [ValidateRange(1, 300)][int]$TimeoutSeconds = 45,
    [Parameter(Mandatory)][string]$SafeError
  )

  $resolvedFile = [IO.Path]::GetFullPath($FilePath)
  if (-not (Test-Path -LiteralPath $resolvedFile -PathType Leaf)) {
    throw $SafeError
  }
  $resolvedArguments = @($Arguments)
  if ([IO.Path]::GetExtension($resolvedFile) -ieq '.ps1') {
    $pwsh = Get-Command pwsh -CommandType Application -ErrorAction Stop
    $resolvedArguments = @('-NoLogo','-NoProfile','-NonInteractive','-File',$resolvedFile) +
      $resolvedArguments
    $resolvedFile = $pwsh.Source
  } elseif ([IO.Path]::GetExtension($resolvedFile) -in '.cmd','.bat') {
    throw "$SafeError`: unsupported command wrapper"
  }

  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $resolvedFile
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.CreateNoWindow = $true
  foreach ($argument in $resolvedArguments) { [void]$startInfo.ArgumentList.Add($argument) }
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  try {
    if (-not $process.Start()) { throw $SafeError }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      try { $process.Kill($true) } catch { }
      try { $process.WaitForExit() } catch { }
      throw "${SafeError}: timeout"
    }
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    [void]$stderrTask.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) { throw $SafeError }
    return [string]$stdout
  } finally {
    $process.Dispose()
  }
}

Export-ModuleMember -Function Invoke-BoundedNativeText
