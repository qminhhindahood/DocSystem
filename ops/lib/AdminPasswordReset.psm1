Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-NativeChecked {
  param(
    [Parameter(Mandatory)][string]$FilePath,
    [Parameter(Mandatory)][string[]]$Arguments
  )

  $output = & $FilePath @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath failed with exit code $LASTEXITCODE"
  }
  return $output
}

function Add-ResetSecretVersion {
  param(
    [Parameter(Mandatory)][string]$ProjectId,
    [Parameter(Mandatory)][string]$SecretId,
    [Parameter(Mandatory)][SecureString]$Password
  )

  [IntPtr]$passwordBstr = [IntPtr]::Zero
  [byte[]]$passwordBytes = $null
  $plainPassword = $null
  $encodedPassword = $null
  $requestBody = $null
  $accessToken = $null
  $tokenOutput = $null

  try {
    $passwordBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordBstr)
    $passwordBytes = [Text.Encoding]::UTF8.GetBytes($plainPassword)
    $encodedPassword = [Convert]::ToBase64String($passwordBytes)
    $requestBody = @{ payload = @{ data = $encodedPassword } } | ConvertTo-Json -Compress

    $tokenOutput = & gcloud auth print-access-token --quiet 2>$null
    if ($LASTEXITCODE -ne 0) {
      throw 'Unable to obtain a Google Cloud access token'
    }
    $accessToken = ([string]($tokenOutput | Select-Object -First 1)).Trim()
    if ([string]::IsNullOrWhiteSpace($accessToken)) {
      throw 'Google Cloud returned an empty access token'
    }

    $uri = "https://secretmanager.googleapis.com/v1/projects/$ProjectId/secrets/$SecretId`:addVersion"
    try {
      $response = Invoke-RestMethod -Uri $uri -Method Post -ContentType 'application/json' `
        -Headers @{ Authorization = "Bearer $accessToken" } -Body $requestBody
    } catch {
      throw 'Secret Manager failed to create the temporary password version'
    }

    $versionName = [string]$response.name
    if ($versionName -notmatch '/versions/(\d+)$') {
      throw 'Secret Manager returned an invalid version name'
    }
    return $Matches[1]
  } finally {
    if ($null -ne $passwordBytes) {
      [Array]::Clear($passwordBytes, 0, $passwordBytes.Length)
    }
    if ($passwordBstr -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBstr)
    }
    $plainPassword = $null
    $encodedPassword = $null
    $requestBody = $null
    $accessToken = $null
    $tokenOutput = $null
  }
}

function Set-ResetJobSecret {
  param(
    [Parameter(Mandatory)][string]$ProjectId,
    [Parameter(Mandatory)][string]$Region,
    [Parameter(Mandatory)][string]$JobName,
    [Parameter(Mandatory)][string]$SecretId,
    [Parameter(Mandatory)][string]$Version
  )

  if ($Version -notmatch '^\d+$') { throw 'Reset binding requires a numeric Secret Manager version' }
  Invoke-NativeChecked gcloud @(
    'run', 'jobs', 'update', $JobName,
    '--project', $ProjectId,
    '--region', $Region,
    '--update-secrets', "RESET_PASSWORD=${SecretId}:$Version",
    '--quiet'
  ) | Out-Null
}

function Invoke-ResetJob {
  param(
    [Parameter(Mandatory)][string]$ProjectId,
    [Parameter(Mandatory)][string]$Region,
    [Parameter(Mandatory)][string]$JobName
  )

  Invoke-NativeChecked gcloud @(
    'run', 'jobs', 'execute', $JobName,
    '--project', $ProjectId,
    '--region', $Region,
    '--wait',
    '--quiet'
  ) | Out-Null
}

function Remove-ResetJobSecret {
  param(
    [Parameter(Mandatory)][string]$ProjectId,
    [Parameter(Mandatory)][string]$Region,
    [Parameter(Mandatory)][string]$JobName
  )

  Invoke-NativeChecked gcloud @(
    'run', 'jobs', 'update', $JobName,
    '--project', $ProjectId,
    '--region', $Region,
    '--remove-secrets', 'RESET_PASSWORD',
    '--quiet'
  ) | Out-Null
}

function Disable-ResetSecretVersion {
  param(
    [Parameter(Mandatory)][string]$ProjectId,
    [Parameter(Mandatory)][string]$SecretId,
    [Parameter(Mandatory)][string]$Version
  )

  if ($Version -notmatch '^\d+$') { throw 'Secret cleanup requires a numeric Secret Manager version' }
  Invoke-NativeChecked gcloud @(
    'secrets', 'versions', 'disable', $Version,
    '--secret', $SecretId,
    '--project', $ProjectId,
    '--quiet'
  ) | Out-Null
}

function Invoke-DocAiAdminPasswordReset {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$ProjectId,
    [Parameter(Mandatory)][string]$Region,
    [Parameter(Mandatory)][string]$JobName,
    [Parameter(Mandatory)][string]$SecretId,
    [Parameter(Mandatory)][SecureString]$Password
  )

  $version = $null
  $operationError = $null
  $cleanupErrors = [System.Collections.Generic.List[string]]::new()

  try {
    $version = Add-ResetSecretVersion -ProjectId $ProjectId -SecretId $SecretId -Password $Password
    if ($Version -notmatch '^\d+$') {
      throw 'Password reset requires a numeric Secret Manager version'
    }
    Set-ResetJobSecret -ProjectId $ProjectId -Region $Region -JobName $JobName -SecretId $SecretId -Version $version
    Invoke-ResetJob -ProjectId $ProjectId -Region $Region -JobName $JobName
  } catch {
    $operationError = $_
  } finally {
    if ($version -match '^\d+$') {
      try {
        Remove-ResetJobSecret -ProjectId $ProjectId -Region $Region -JobName $JobName
      } catch {
        $cleanupErrors.Add('job secret binding removal failed') | Out-Null
      }
      try {
        Disable-ResetSecretVersion -ProjectId $ProjectId -SecretId $SecretId -Version $version
      } catch {
        $cleanupErrors.Add('secret version disable failed') | Out-Null
      }
    }
  }

  if ($null -ne $operationError) {
    $message = $operationError.Exception.Message
    if ($cleanupErrors.Count -gt 0) {
      $message = "$message. Cleanup also failed: $($cleanupErrors -join '; ')"
    }
    throw [InvalidOperationException]::new($message, $operationError.Exception)
  }
  if ($cleanupErrors.Count -gt 0) {
    throw "Operator reset cleanup failed for secret version $version`: $($cleanupErrors -join '; ')"
  }

  [pscustomobject]@{
    Version     = $version
    SecretState = 'DISABLED'
  }
}

Export-ModuleMember -Function Invoke-DocAiAdminPasswordReset
