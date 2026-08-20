# PostgresTools.psm1 — shared helper for the slim standalone verification suite.
#
# The master stack's cutover helpers (database identity comparison, primary-key
# hashing, rehearsal-name guards) belonged to the deleted GCP/Neon migration
# runbooks and were removed with them. Only the native-command wrapper survives,
# because ops/verify-all.ps1 still uses it to fail fast on any non-zero exit.

function Invoke-NativeChecked {
  <#
  .SYNOPSIS
    Run a native command and throw if it exits non-zero.
  .PARAMETER File
    Path to the executable.
  .PARAMETER Arguments
    Array of argument strings.
  #>
  param(
    [Parameter(Mandatory = $true)][string]$File,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
  )
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$File failed with exit code $LASTEXITCODE"
  }
}

Export-ModuleMember -Function Invoke-NativeChecked
