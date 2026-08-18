param(
  [Parameter(Mandatory)][string]$ProjectId,
  [Parameter(Mandatory)][string]$Region,
  [string]$JobName = 'docai-reset-password',
  [string]$SecretId = 'docai-admin-reset-password'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path (Split-Path $PSScriptRoot -Parent) 'lib/AdminPasswordReset.psm1') -Force

function Assert-MatchingPassword {
  param(
    [Parameter(Mandatory)][SecureString]$First,
    [Parameter(Mandatory)][SecureString]$Second
  )

  [IntPtr]$firstBstr = [IntPtr]::Zero
  [IntPtr]$secondBstr = [IntPtr]::Zero
  $firstText = $null
  $secondText = $null
  try {
    $firstBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($First)
    $secondBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Second)
    $firstText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($firstBstr)
    $secondText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secondBstr)
    if ($firstText.Length -lt 8 -or $firstText.Length -gt 100) {
      throw 'Password must contain 8 to 100 characters'
    }
    if (-not [string]::Equals($firstText, $secondText, [StringComparison]::Ordinal)) {
      throw 'Password confirmation does not match'
    }
  } finally {
    if ($firstBstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($firstBstr) }
    if ($secondBstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secondBstr) }
    $firstText = $null
    $secondText = $null
  }
}

$activeAccountOutput = & gcloud auth list --filter=status:ACTIVE --format=value(account) 2>$null
if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the active gcloud account' }
$activeAccount = ([string]($activeAccountOutput | Select-Object -First 1)).Trim()
if ([string]::IsNullOrWhiteSpace($activeAccount)) { throw 'No active gcloud account is configured' }

Write-Host "Project: $ProjectId"
Write-Host "Region:  $Region"
Write-Host "Account: $activeAccount"
Write-Host "Job:     $JobName"

$confirmation = Read-Host "Type the exact project ID to continue"
if ($confirmation -cne $ProjectId) { throw 'Project confirmation did not match' }

$password = Read-Host 'New operator password' -AsSecureString
$passwordConfirmation = Read-Host 'Confirm new operator password' -AsSecureString
Assert-MatchingPassword -First $password -Second $passwordConfirmation

$result = Invoke-DocAiAdminPasswordReset -ProjectId $ProjectId -Region $Region -JobName $JobName `
  -SecretId $SecretId -Password $password
Write-Host "Operator credential reset completed; temporary secret version $($result.Version) is $($result.SecretState)."
