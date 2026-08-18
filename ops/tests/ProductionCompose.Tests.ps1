Describe 'production Compose contract' {
  BeforeAll {
    $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
    $contract = Join-Path $repoRoot 'ops/test-prod-compose.ps1'
  }

  It 'rejects missing build contexts and broken BFF routing' {
    & $contract
    $LASTEXITCODE | Should -Be 0
  }
}
