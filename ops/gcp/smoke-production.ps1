#!/usr/bin/env pwsh
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$ProjectId,
  [Parameter(Mandatory)][string]$Region,
  [Parameter(Mandatory)][string]$FrontendUrl,
  [Parameter(Mandatory)][string]$BackendUrl,
  [Parameter(Mandatory)][string]$FixturePath,
  [Parameter(Mandatory)][string]$TemplateFixturePath,
  [int]$TimeoutSeconds = 600
)

$ErrorActionPreference = 'Stop'
$FrontendUrl = $FrontendUrl.TrimEnd('/')
$BackendUrl = $BackendUrl.TrimEnd('/')
$fixture = (Resolve-Path -LiteralPath $FixturePath).Path
$templateFixture = (Resolve-Path -LiteralPath $TemplateFixturePath).Path
if ([System.IO.Path]::GetExtension($fixture).ToLowerInvariant() -ne '.pdf') {
  throw 'FixturePath must reference a PDF accepted by the ingestion API'
}
if ([System.IO.Path]::GetExtension($templateFixture).ToLowerInvariant() -ne '.docx') {
  throw 'TemplateFixturePath must reference a DOCX accepted by the template API'
}
$fixtureContentType = 'application/pdf'

function Assert-Status([string]$Name, $Response, [int[]]$Expected = @(200)) {
  if ($Response.StatusCode -notin $Expected) {
    throw "$Name returned HTTP $($Response.StatusCode); expected $($Expected -join ', ')"
  }
  Write-Host "PASS: $Name" -ForegroundColor Green
}

function Get-Secret([string]$EnvironmentName) {
  $secret = [Environment]::GetEnvironmentVariable($EnvironmentName)
  if (-not $secret) { throw "$EnvironmentName is required" }
  $value = & gcloud secrets versions access latest --secret $secret --project $ProjectId
  if ($LASTEXITCODE -ne 0 -or -not $value) { throw "Unable to load $secret from Secret Manager" }
  return ($value -join "`n").Trim()
}

function Get-IdentityHeaders([string]$Audience) {
  $token = & gcloud auth print-identity-token --audiences=$Audience 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $token) {
    $serviceAccount = [Environment]::GetEnvironmentVariable('SMOKE_SERVICE_ACCOUNT')
    if (-not $serviceAccount) { throw "Unable to mint ID token for $Audience" }
    $accessToken = & gcloud auth print-access-token
    if ($LASTEXITCODE -ne 0 -or -not $accessToken) { throw 'Unable to load an access token for smoke identity impersonation' }
    $escapedAccount = [uri]::EscapeDataString($serviceAccount)
    $tokenResponse = Invoke-RestMethod `
      -Uri "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${escapedAccount}:generateIdToken" `
      -Method Post `
      -Headers @{ Authorization = "Bearer $($accessToken.Trim())" } `
      -ContentType 'application/json' `
      -Body (@{ audience = $Audience; includeEmail = $true } | ConvertTo-Json -Compress)
    $token = $tokenResponse.token
  }
  if (-not $token) { throw "Unable to mint ID token for $Audience" }
  return @{ 'X-Serverless-Authorization' = "Bearer $($token.Trim())" }
}

function Invoke-MultipartJson(
  [string]$Url,
  $Session,
  [string]$Origin,
  [string]$FilePath,
  [string]$FileContentType,
  [hashtable]$Fields
) {
  $handler = [System.Net.Http.HttpClientHandler]::new()
  $handler.CookieContainer = $Session.Cookies
  $client = [System.Net.Http.HttpClient]::new($handler)
  $multipart = [System.Net.Http.MultipartFormDataContent]::new()
  $stream = $null
  $response = $null
  try {
    $client.DefaultRequestHeaders.TryAddWithoutValidation('Origin', $Origin) | Out-Null
    foreach ($entry in $Fields.GetEnumerator()) {
      $multipart.Add([System.Net.Http.StringContent]::new([string]$entry.Value), [string]$entry.Key)
    }
    $stream = [System.IO.File]::OpenRead($FilePath)
    $fileContent = [System.Net.Http.StreamContent]::new($stream)
    $fileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::new($FileContentType)
    $multipart.Add($fileContent, 'file', [System.IO.Path]::GetFileName($FilePath))
    $response = $client.PostAsync($Url, $multipart).GetAwaiter().GetResult()
    $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    if (-not $response.IsSuccessStatusCode) {
      throw "Multipart upload returned HTTP $([int]$response.StatusCode): $body"
    }
    return $body | ConvertFrom-Json
  } finally {
    if ($null -ne $response) { $response.Dispose() }
    $multipart.Dispose()
    if ($null -ne $stream) { $stream.Dispose() }
    $client.Dispose()
    $handler.Dispose()
  }
}

$username = Get-Secret 'SMOKE_USERNAME_SECRET'
$password = Get-Secret 'SMOKE_PASSWORD_SECRET'
$origin = ([uri]$FrontendUrl).GetLeftPart([System.UriPartial]::Authority)
$session = $null
$createdTemplateId = $null
$createdDocumentId = $null

try {
  Assert-Status 'frontend liveness' (Invoke-WebRequest "$FrontendUrl/api/live" -SkipHttpErrorCheck)
  $readinessDeadline = [DateTime]::UtcNow.AddSeconds([Math]::Min($TimeoutSeconds, 180))
  do {
    $readiness = Invoke-WebRequest "$FrontendUrl/api/ready" -SkipHttpErrorCheck
    if ($readiness.StatusCode -eq 200) { break }
    Write-Host 'WAIT: frontend readiness warm-up' -ForegroundColor Yellow
    Start-Sleep -Seconds 15
  } while ([DateTime]::UtcNow -lt $readinessDeadline)
  Assert-Status 'frontend readiness' $readiness

  $signupProbe = Invoke-WebRequest "$FrontendUrl/api/session/signup" -Method Post `
    -ContentType 'application/json' -Headers @{ Origin = $origin } `
    -Body (@{
      username = "smoke-no-challenge-$([DateTime]::UtcNow.ToString('HHmmss'))"
      email = "smoke-no-challenge-$([DateTime]::UtcNow.ToString('HHmmss'))@example.invalid"
      password = 'Smoke-missing-challenge-123'
      passwordConfirmation = 'Smoke-missing-challenge-123'
    } | ConvertTo-Json) -SkipHttpErrorCheck
  Assert-Status 'signup rejects missing Turnstile challenge' $signupProbe @(400)
  if (($signupProbe.Content | ConvertFrom-Json).code -ne 'TURNSTILE_REQUIRED') {
    throw 'Signup endpoint did not return TURNSTILE_REQUIRED'
  }

  $forgot = Invoke-WebRequest "$FrontendUrl/api/session/forgot-password" -Method Post `
    -ContentType 'application/json' -Headers @{ Origin = $origin } `
    -Body (@{ email = 'operator@example.invalid' } | ConvertTo-Json) -SkipHttpErrorCheck
  Assert-Status 'email password recovery disabled' $forgot @(503)
  if (($forgot.Content | ConvertFrom-Json).code -ne 'PASSWORD_RESET_DISABLED') {
    throw 'Forgot-password endpoint did not return PASSWORD_RESET_DISABLED'
  }

  $resetToken = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
  $resetPassword = 'Smoke-disabled-only-password-123'
  $reset = Invoke-WebRequest "$FrontendUrl/api/session/reset-password" -Method Post `
    -ContentType 'application/json' -Headers @{ Origin = $origin } `
    -Body (@{ token = $resetToken; password = $resetPassword } | ConvertTo-Json) -SkipHttpErrorCheck
  Assert-Status 'token password recovery disabled' $reset @(503)
  if (($reset.Content | ConvertFrom-Json).code -ne 'PASSWORD_RESET_DISABLED') {
    throw 'Reset-password endpoint did not return PASSWORD_RESET_DISABLED'
  }
  $resetToken = $null
  $resetPassword = $null

  $privateUrls = @{
    backend    = $BackendUrl
    docling    = [Environment]::GetEnvironmentVariable('DOCLING_URL')
    embeddings = [Environment]::GetEnvironmentVariable('EMBEDDINGS_URL')
    renderer   = [Environment]::GetEnvironmentVariable('RENDERER_URL')
  }
  foreach ($entry in $privateUrls.GetEnumerator()) {
    if ([string]::IsNullOrWhiteSpace($entry.Value)) { throw "$($entry.Key) private service URL is required" }
    $unauthenticated = Invoke-WebRequest "$($entry.Value)/live" -SkipHttpErrorCheck
    Assert-Status "$($entry.Key) rejects unauthenticated access" $unauthenticated @(403)
    $audience = if ($entry.Key -eq 'backend') {
      [Environment]::GetEnvironmentVariable('BACKEND_AUDIENCE')
    } else {
      $entry.Value
    }
    if ([string]::IsNullOrWhiteSpace($audience)) { throw "$($entry.Key) ID-token audience is required" }
    $authenticated = Invoke-WebRequest "$($entry.Value)/live" -Headers (Get-IdentityHeaders $audience) -SkipHttpErrorCheck
    Assert-Status "$($entry.Key) accepts smoke identity" $authenticated
  }

  $loginBody = @{ username = $username; password = $password } | ConvertTo-Json
  $login = Invoke-WebRequest "$FrontendUrl/api/session/login" -Method Post -ContentType 'application/json' `
    -Headers @{ Origin = $origin } -Body $loginBody -SessionVariable session -SkipHttpErrorCheck
  Assert-Status 'operator login' $login

  $llmSettingsResponse = Invoke-WebRequest "$FrontendUrl/api/proxy/settings/llm" -WebSession $session -SkipHttpErrorCheck
  Assert-Status 'LLM settings load' $llmSettingsResponse
  $llmSettings = $llmSettingsResponse.Content | ConvertFrom-Json
  $hasLlmConfig = $null -ne $llmSettings.config
  Assert-Status 'template list' (Invoke-WebRequest "$FrontendUrl/api/proxy/templates" -WebSession $session -SkipHttpErrorCheck)

  $upload = Invoke-MultipartJson "$FrontendUrl/api/proxy/rag/index" $session $origin $fixture `
    $fixtureContentType @{ docType = 'quyet-dinh' }
  $createdDocumentId = $upload.documentId
  if (-not $createdDocumentId) { throw 'Fixture upload did not return documentId' }

  $sessionCookie = $session.Cookies.GetCookies([uri]$FrontendUrl)['docai_session']?.Value
  if (-not $sessionCookie) { throw 'Login did not establish the DocAI session cookie' }
  $backendAudience = [Environment]::GetEnvironmentVariable('BACKEND_AUDIENCE')
  if ([string]::IsNullOrWhiteSpace($backendAudience)) { throw 'Canonical backend ID-token audience is required' }
  $backendHeaders = Get-IdentityHeaders $backendAudience
  $backendHeaders.Authorization = "Bearer $sessionCookie"
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Seconds 15
    $statusResponse = Invoke-RestMethod "$BackendUrl/api/rag/status/$createdDocumentId" -Headers $backendHeaders
    $ingestionStatus = $statusResponse.document.ingestionStatus
    if ($ingestionStatus -in @('failed', 'partial')) { throw "Smoke ingestion ended in $ingestionStatus" }
  } while ($ingestionStatus -ne 'indexed' -and [DateTime]::UtcNow -lt $deadline)
  if ($ingestionStatus -ne 'indexed') { throw 'Smoke ingestion timed out' }
  Write-Host 'PASS: fixture ingestion and embeddings' -ForegroundColor Green

  $template = Invoke-MultipartJson "$FrontendUrl/api/proxy/templates" $session $origin $templateFixture `
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document' @{
      name = "production-smoke-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmss'))"
      docType = 'quyet-dinh'
    }
  $createdTemplateId = $template.template.id
  if (-not $createdTemplateId) { throw 'Template upload did not return an ID' }
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Seconds 5
    $templateRecord = (Invoke-RestMethod "$FrontendUrl/api/proxy/templates/$createdTemplateId" -WebSession $session).template
    $templateStatus = $templateRecord.status
    if ($templateStatus -eq 'REJECTED') {
      throw "Template rendering ended in REJECTED ($($templateRecord.rejectionCode))"
    }
    if ($templateStatus -eq 'FAILED') {
      if (-not $hasLlmConfig -and $templateRecord.rejectionCode -eq 'VISION_MODEL_REQUIRED') { break }
      throw "Template rendering ended in FAILED ($($templateRecord.rejectionCode))"
    }
  } while ($templateStatus -notin @('READY', 'NEEDS_REVIEW') -and [DateTime]::UtcNow -lt $deadline)
  if ($templateStatus -eq 'FAILED' -and -not $hasLlmConfig) {
    Write-Host 'PASS: renderer structural analysis (vision fusion awaits user LLM configuration)' -ForegroundColor Green
    Write-Host 'SKIP: LLM-dependent template fusion and Q&A (no smoke-user LLM configuration)' -ForegroundColor Yellow
  } else {
    if ($templateStatus -notin @('READY', 'NEEDS_REVIEW')) { throw 'Template rendering timed out' }
    Assert-Status 'rendered template download' (Invoke-WebRequest "$FrontendUrl/api/proxy/templates/$createdTemplateId/download" -WebSession $session -SkipHttpErrorCheck)

    $qaBody = @{ question = 'Tài liệu kiểm thử này nói về nội dung gì?'; topK = 1 } | ConvertTo-Json
    $qa = Invoke-WebRequest "$FrontendUrl/api/proxy/qa/ask" -Method Post -ContentType 'application/json' `
      -Headers @{ Origin = $origin } -Body $qaBody -WebSession $session -TimeoutSec $TimeoutSeconds -SkipHttpErrorCheck
    Assert-Status 'Q&A SSE response' $qa
    if ($qa.Content -notmatch '"stage":"complete"') { throw 'Q&A SSE stream did not reach completion' }
    Write-Host 'PASS: Q&A SSE completion' -ForegroundColor Green
  }
} finally {
  if ($createdTemplateId) {
    $cleanup = Invoke-WebRequest "$FrontendUrl/api/proxy/templates/$createdTemplateId" -Method Delete -Headers @{ Origin = $origin } `
      -WebSession $session -SkipHttpErrorCheck
    Assert-Status 'template cleanup' $cleanup
  }
  if ($createdDocumentId) {
    $cleanup = Invoke-WebRequest "$FrontendUrl/api/proxy/documents/$createdDocumentId" -Method Delete -Headers @{ Origin = $origin } `
      -WebSession $session -SkipHttpErrorCheck
    Assert-Status 'document cleanup' $cleanup
  }
}

Write-Host 'Production smoke passed and fixture data was cleaned up.' -ForegroundColor Green
