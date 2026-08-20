# RepositoryHygiene.Tests.ps1 — development hygiene for the standalone conversion product.
#
# The master-stack hygiene checks (docling/embeddings Dockerfiles, Terraform,
# cloudflare-worker lockfile, add_header portability) were deleted with their
# surfaces (ticket 08). This suite now locks what remains: tracked lockfiles for
# clean Docker builds, pinned container bases, the Pester 5 load order in the
# verifier, and the continued absence of the deleted master-stack surfaces.

Describe 'Repository development hygiene (standalone)' {
  BeforeAll {
    $root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
  }

  It 'tracks lockfiles required by clean Docker builds' {
    Test-Path -LiteralPath (Join-Path $root 'backend/package-lock.json') | Should -BeTrue
    Test-Path -LiteralPath (Join-Path $root 'frontend/package-lock.json') | Should -BeTrue
    (& git -C $root check-ignore backend/package-lock.json frontend/package-lock.json 2>$null) | Should -BeNullOrEmpty
  }

  It 'declares Python test dependencies separately from the conversion runtime image' {
    $dev = Get-Content -LiteralPath (Join-Path $root 'conversion-service/requirements-dev.txt') -Raw
    $dev | Should -Match '(?m)^pytest'
    $dev | Should -Match '(?m)^fakeredis'
    # The runtime image must never bake in the test dependencies.
    $dockerfile = Get-Content -LiteralPath (Join-Path $root 'conversion-service/Dockerfile') -Raw
    $dockerfile | Should -Match 'requirements\.txt'
    $dockerfile | Should -Not -Match 'requirements-dev\.txt'
  }

  It 'pins minimal production container bases' {
    $backendDockerfile = Get-Content -LiteralPath (Join-Path $root 'backend/Dockerfile') -Raw
    $backendDockerfile | Should -Match 'FROM node:22-alpine@sha256:[a-f0-9]{64}'
    $backendDockerfile | Should -Match 'rm -rf /usr/local/lib/node_modules/npm'

    $frontendDockerfile = Get-Content -LiteralPath (Join-Path $root 'frontend/Dockerfile') -Raw
    $frontendDockerfile | Should -Match 'FROM node:22-alpine@sha256:[a-f0-9]{64}'
    $frontendDockerfile | Should -Match 'rm -rf /usr/local/lib/node_modules/npm'
    $frontendDockerfile | Should -Match 'output: .standalone|\.next/standalone'
  }

  It 'loads Pester 5 explicitly before running operations tests' {
    $verifier = Get-Content -LiteralPath (Join-Path $root 'ops/verify-all.ps1') -Raw
    $verifier | Should -Match 'Pester[/\\]5\.7\.1[/\\]Pester\.psd1'
    $verifier | Should -Match 'Import-Module\s+\$pesterModulePath\s+-Force'
    $verifier.IndexOf('Import-Module $pesterModulePath -Force') | Should -BeLessThan $verifier.IndexOf('Invoke-Pester')
  }

  It 'keeps the deleted master-stack surfaces absent' {
    foreach ($dead in @('docling-service', 'embeddings-service', 'document-renderer', 'cloudflare-worker', 'infra', 'deploy', 'templates', 'add_header.py')) {
      Test-Path -LiteralPath (Join-Path $root $dead) | Should -BeFalse
    }
    Test-Path -LiteralPath (Join-Path $root '.github/workflows/deploy-production.yml') | Should -BeFalse
  }
}
