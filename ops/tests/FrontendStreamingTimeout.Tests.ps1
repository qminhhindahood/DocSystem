$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent | Split-Path -Parent
$cloudRun = Get-Content -LiteralPath (Join-Path $root 'infra/terraform/cloud_run.tf') -Raw
$workflow = Get-Content -LiteralPath (Join-Path $root '.github/workflows/deploy-production.yml') -Raw

$frontendBlock = [regex]::Match(
  $cloudRun,
  '(?s)resource "google_cloud_run_v2_service" "frontend" \{(?<body>.*?)(?=\r?\nresource ")'
).Groups['body'].Value

if (-not $frontendBlock -or $frontendBlock -notmatch 'timeout\s*=\s*"900s"') {
  throw 'Frontend Cloud Run timeout must allow the full 900-second streaming workflow'
}

if ($workflow -notmatch '(?m)gcloud run deploy docai-frontend .*--timeout[= ]900') {
  throw 'Production deploy must preserve the 900-second frontend streaming timeout'
}

Write-Host 'PASS: frontend streaming timeout is protected in Terraform and deployment' -ForegroundColor Green
