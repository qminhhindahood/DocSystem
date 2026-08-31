# GitHubWorkflow.Tests.ps1 — CI contract for the standalone conversion product.
#
# The master stack's deploy-production workflow and its GCP/Terraform assertions
# were deleted with the production pipeline (ticket 08). This suite now locks the
# slim CI: the three product jobs, the scanned container matrix, and the
# repository-contracts job that runs the slim ops verifier.

Describe 'GitHub CI workflow contract (standalone)' {
  BeforeAll {
    $root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
    $script:ciPath = Join-Path $root '.github/workflows/ci.yml'
    $script:ciRaw = Get-Content -LiteralPath $script:ciPath -Raw
  }

  It 'runs CI for pull requests' {
    $script:ciRaw | Should -Match '(?m)^on:\s*\r?\n\s+pull_request:'
  }

  It 'runs the same CI when main changes' {
    $script:ciRaw | Should -Match '(?m)^  push:\s*\r?\n    branches:\s*\[main\]'
  }

  It 'keeps exactly the standalone product jobs' {
    foreach ($job in @('backend', 'frontend', 'conversion', 'containers', 'repository-contracts')) {
      $script:ciRaw | Should -Match "(?m)^  $job\:"
    }
    foreach ($dead in @('worker', 'renderer', 'python', 'terraform')) {
      $script:ciRaw | Should -Not -Match "(?m)^  $dead\:"
    }
  }

  It 'does not authenticate to Google Cloud' {
    $script:ciRaw | Should -Not -Match 'google-github-actions/auth|id-token:\s*write'
  }

  It 'exercises the canonical slim verifier with Pester 5.7.1' {
    $script:ciRaw | Should -Match 'ops/verify-all\.ps1'
    $script:ciRaw | Should -Match 'Install-Module Pester -RequiredVersion 5\.7\.1'
  }

  It 'uses a full checkout for history-sensitive migration contracts' {
    $script:ciRaw | Should -Match 'fetch-depth:\s*0'
  }

  It 'provides the backend job with non-secret contract-test dependency URLs' {
    $script:ciRaw | Should -Match 'DATABASE_URL:\s*postgresql://'
    $script:ciRaw | Should -Match 'REDIS_URL:\s*redis://'
    $script:ciRaw | Should -Match 'CONVERSION_SERVICE_URL:\s*http://'
  }

  It 'builds exactly the backend, conversion, and frontend container images' {
    $script:ciRaw | Should -Match '- service: backend'
    $script:ciRaw | Should -Match '- service: conversion'
    $script:ciRaw | Should -Match '- service: frontend'
    foreach ($dead in @('docling', 'embeddings', 'renderer')) {
      $script:ciRaw | Should -Not -Match "- service: $dead"
    }
  }

  It 'scans every container image with the pinned post-incident Trivy action' {
    $script:ciRaw | Should -Match 'aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25'
    $script:ciRaw | Should -Match 'scanners:\s*vuln'
    $script:ciRaw.Contains("severity: 'CRITICAL,HIGH'") | Should -BeTrue
    $script:ciRaw.Contains("ignore-unfixed: 'false'") | Should -BeTrue
    $script:ciRaw.Contains("exit-code: '1'") | Should -BeTrue
  }

  It 'separates production and development dependency audits' {
    foreach ($name in @(
      'Audit backend production dependencies',
      'Audit backend development dependencies',
      'Audit frontend production dependencies',
      'Audit frontend development dependencies'
    )) {
      $script:ciRaw | Should -Match ([regex]::Escape("name: $name"))
    }
    ($script:ciRaw | Select-String -Pattern 'npm audit --omit=dev --audit-level=high' -AllMatches).Matches.Count | Should -Be 2
    ($script:ciRaw | Select-String -Pattern 'npm audit --audit-level=high' -AllMatches).Matches.Count | Should -Be 2
  }

  It 'enforces typography integrity and the offline release render gate' {
    $script:ciRaw | Should -Match 'name: Verify typography sync'
    $script:ciRaw | Should -Match 'python scripts/check_typography_sync\.py'
    $script:ciRaw | Should -Match 'name: Run release render preflight'
    $script:ciRaw | Should -Match 'python eval/verify_p0a\.py'
  }

  It 'creates the gitignored Compose env file from its safe example' {
    $script:ciRaw | Should -Match 'cp backend/\.env\.example backend/\.env'
  }

  It 'has no production deploy workflow' {
    Test-Path -LiteralPath (Join-Path (Split-Path $script:ciPath) 'deploy-production.yml') | Should -BeFalse
  }
}
