#!/usr/bin/env pwsh
[CmdletBinding()]
param(
  [string]$ProjectName = "docai_renderer_test_$([Guid]::NewGuid().ToString('N').Substring(0, 12))"
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if ($ProjectName -notmatch '^docai_renderer_test_[a-z0-9_-]+$') {
  throw 'Disposable renderer project name must begin with docai_renderer_test_ and contain only safe characters'
}
if (-not $env:DB_PASSWORD) { $env:DB_PASSWORD = 'renderer-smoke-only' }
if (-not $env:RENDERER_INTERNAL_TOKEN) { $env:RENDERER_INTERNAL_TOKEN = 'renderer-smoke-token-at-least-32-characters' }

$compose = @('compose', '-p', $ProjectName)
$fixture = Join-Path $root 'docs/12-2017-tt-bgddt-19-05-2017.docx'
if (-not (Test-Path -LiteralPath $fixture)) { throw 'Representative DOCX fixture is missing' }

function Invoke-Docker([string[]]$Arguments, [switch]$Capture) {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $output = & docker @Arguments 2>&1 } finally { $ErrorActionPreference = $previousPreference }
  if ($LASTEXITCODE -ne 0) { throw "docker command failed: $($output -join [Environment]::NewLine)" }
  if ($Capture) { return ($output -join [Environment]::NewLine).Trim() }
}

function Invoke-RendererJson([string]$ContainerId, [string]$Path, [string]$Body) {
  $requestFile = Join-Path ([IO.Path]::GetTempPath()) "renderer-request-$([Guid]::NewGuid().ToString('N')).json"
  try {
    [IO.File]::WriteAllText($requestFile, $Body, [Text.UTF8Encoding]::new($false))
    Invoke-Docker @('cp', $requestFile, "${ContainerId}:/tmp/request.json")
    $response = Invoke-Docker @(
      'exec', $ContainerId, 'curl', '-sS', '-w', "`n%{http_code}",
      '-H', "X-Renderer-Token: $env:RENDERER_INTERNAL_TOKEN",
      '-H', 'Content-Type: application/json',
      '--data-binary', '@/tmp/request.json',
      "http://localhost:8080$Path"
    ) -Capture
  } finally {
    if (Test-Path -LiteralPath $requestFile) { Remove-Item -LiteralPath $requestFile -Force }
  }
  $lines = $response -split "`r?`n"
  $status = $lines[-1]
  $payload = ($lines[0..($lines.Length - 2)] -join "`n")
  if ($status -notmatch '^2\d\d$') { throw "Renderer request $Path failed with HTTP ${status}: $payload" }
  return $payload
}

try {
  Push-Location $root
  try {
    Invoke-Docker ($compose + @('up', '-d', '--build', '--no-deps', 'document-renderer'))
    $containerId = Invoke-Docker ($compose + @('ps', '-q', 'document-renderer')) -Capture
    if (-not $containerId) { throw 'Renderer container was not created' }

    $ready = $false
    for ($attempt = 1; $attempt -le 30; $attempt += 1) {
      $previousPreference = $ErrorActionPreference
      $ErrorActionPreference = 'Continue'
      try { & docker exec $containerId curl -fsS http://localhost:8080/ready *> $null } finally {
        $readyExitCode = $LASTEXITCODE
        $ErrorActionPreference = $previousPreference
      }
      if ($readyExitCode -eq 0) { $ready = $true; break }
      Start-Sleep -Seconds 2
    }
    if (-not $ready) {
      $logs = Invoke-Docker ($compose + @('logs', '--no-color', 'document-renderer')) -Capture
      throw "Renderer did not become ready: $logs"
    }

    Invoke-Docker @('cp', $fixture, "${containerId}:/tmp/representative.docx")
    Invoke-Docker @('exec', $containerId, 'mkdir', '-p', '/data/templates/originals/smoke-user')
    Invoke-Docker @('exec', $containerId, 'cp', '/tmp/representative.docx', '/data/templates/originals/smoke-user/smoke-template.docx')
    $sourceHash = (Get-FileHash -LiteralPath $fixture -Algorithm SHA256).Hash.ToLowerInvariant()
    $analyzeBody = @{
      template_id = 'smoke-template'
      relative_path = 'originals/smoke-user/smoke-template.docx'
      sha256 = $sourceHash
    } | ConvertTo-Json -Compress
    $analyzeJson = Invoke-RendererJson $containerId '/internal/templates/analyze' $analyzeBody
    $analysis = $analyzeJson | ConvertFrom-Json
    if (-not $analysis.success -or -not $analysis.baseline_pages -or -not $analysis.labeled_pages) {
      throw 'Representative analysis did not produce baseline and labeled pages'
    }
    foreach ($path in @($analysis.baseline_pages) + @($analysis.labeled_pages)) {
      Invoke-Docker @('exec', $containerId, 'test', '-s', "/data/templates/$path")
    }

    $candidate = $analysis.candidates | Select-Object -First 1
    if (-not $candidate.locator) { throw 'Representative analysis produced no editable locator' }
    $renderBody = @{
      template_id = 'smoke-template'
      owner_id = 'smoke-user'
      document_id = 'smoke-document'
      relative_path = 'originals/smoke-user/smoke-template.docx'
      values = @{ smoke_field = 'Nội dung kiểm tra' }
      mappings = @(@{ field_name = 'smoke_field'; locator = $candidate.locator })
    } | ConvertTo-Json -Compress -Depth 8
    $renderJson = Invoke-RendererJson $containerId '/internal/templates/render' $renderBody
    $render = $renderJson | ConvertFrom-Json
    if (-not $render.success -or $render.output_relative_path -ne 'generated/smoke-user/smoke-document.docx') {
      throw 'Representative generation did not publish the expected structurally valid DOCX'
    }
    Invoke-Docker @('exec', $containerId, 'test', '-s', '/data/templates/generated/smoke-user/smoke-document.docx')

    $containerHash = Invoke-Docker @('exec', $containerId, 'sha256sum', '/data/templates/originals/smoke-user/smoke-template.docx') -Capture
    if (($containerHash -split '\s+')[0] -ne $sourceHash) { throw 'Renderer mutated the authoritative source DOCX' }
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $proprietaryPattern = '*As' + 'pose*'
    try { $residue = & docker exec $containerId find /app -iname $proprietaryPattern -print 2>&1 } finally {
      $residueExitCode = $LASTEXITCODE
      $ErrorActionPreference = $previousPreference
    }
    if ($residueExitCode -ne 0) { throw 'Renderer residue scan failed' }
    if ($residue) { throw "Proprietary renderer residue found: $residue" }
  } finally {
    Pop-Location
  }
} finally {
  Push-Location $root
  try {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & docker @compose down -v --remove-orphans *> $null } finally { $ErrorActionPreference = $previousPreference }
  } finally { Pop-Location }
}

$containers = & docker ps -a --filter "label=com.docker.compose.project=$ProjectName" --format '{{.Names}}'
$volumes = & docker volume ls --filter "label=com.docker.compose.project=$ProjectName" --format '{{.Name}}'
if ($containers -or $volumes) { throw 'Disposable renderer resources were not fully removed' }
Write-Output 'Renderer container smoke test passed.'
