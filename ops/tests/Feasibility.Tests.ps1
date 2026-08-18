BeforeAll {
  $Root = Split-Path $PSScriptRoot -Parent | Split-Path -Parent
  Import-Module (Join-Path $Root 'ops/lib/PreflightPolicy.psm1') -Force
}

Describe 'Neon region selection' {
  It 'keeps Ohio unless both improvement constraints pass' {
    Select-NeonRegion @{
      'aws-us-east-2' = @{ medianMs = 100; p95Ms = 150; samples = 20 }
      'aws-us-east-1' = @{ medianMs = 86; p95Ms = 140; samples = 20 }
    } | Should -Be 'aws-us-east-2'

    Select-NeonRegion @{
      'aws-us-east-2' = @{ medianMs = 100; p95Ms = 150; samples = 20 }
      'aws-us-east-1' = @{ medianMs = 84; p95Ms = 160; samples = 20 }
    } | Should -Be 'aws-us-east-1'
  }

  It 'rejects an unavailable or incomplete candidate' {
    Select-NeonRegion @{
      'aws-us-east-2' = @{ medianMs = 100; p95Ms = 150; samples = 20; availableOnFreePlan = $true }
      'aws-us-east-1' = @{ medianMs = 50; p95Ms = 50; samples = 19; availableOnFreePlan = $true }
      'aws-us-west-2' = @{ medianMs = 40; p95Ms = 40; samples = 20; availableOnFreePlan = $false }
    } | Should -Be 'aws-us-east-2'
  }
}

Describe 'Image retention footprint' {
  It 'counts current and rollback copies without layer deduplication' {
    $result = Measure-RetainedImageBytes -ImageSizes @(100, 200, 300) -Ceiling 1200
    $result.retainedBytes | Should -Be 1200
    $result.status | Should -Be 'passed'
  }

  It 'blocks one byte above the conservative ceiling' {
    (Measure-RetainedImageBytes -ImageSizes @(200, 401) -Ceiling 1200).status |
      Should -Be 'blocked'
  }
}

Describe 'Artifact Registry recurring-cost estimate' {
  It 'keeps a footprint within the official free tier at zero cost' {
    $estimate = Get-ArtifactRegistryMonthlyCostEstimate -RetainedBytes 419430400 `
      -FreeBytes 536870912 -RatePerGiBMonth 0.10 -SourceSnapshotSha256 ('a' * 64)
    $estimate.monthlyCostUsd | Should -Be 0
    $estimate.zeroCostFeasible | Should -BeTrue
    $estimate.requiresApproval | Should -BeFalse
  }

  It 'rounds the conservative two-release footprint upward to the nearest cent' {
    $estimate = Get-ArtifactRegistryMonthlyCostEstimate -RetainedBytes 4390931158 `
      -FreeBytes 536870912 -RatePerGiBMonth 0.10 -SourceSnapshotSha256 ('b' * 64)
    $estimate.monthlyCostUsd | Should -Be 0.36
    $estimate.zeroCostFeasible | Should -BeFalse
    $estimate.requiresApproval | Should -BeTrue
  }

  It 'blocks when the official free tier or rate is unavailable' {
    $estimate = Get-ArtifactRegistryMonthlyCostEstimate -RetainedBytes 1 `
      -FreeBytes $null -RatePerGiBMonth $null -SourceSnapshotSha256 $null
    $estimate.monthlyCostUsd | Should -BeNullOrEmpty
    $estimate.ratesKnown | Should -BeFalse
    $estimate.requiresApproval | Should -BeTrue
  }
}

Describe 'Production container supply chain' {
  It 'rejects mutable external base images in every retained production Dockerfile' {
    $dockerfiles = @(
      'backend/Dockerfile'
      'frontend/Dockerfile'
      'docling-service/Dockerfile'
      'embeddings-service/Dockerfile'
      'document-renderer/Dockerfile'
    )
    $mutableReferences = [Collections.Generic.List[string]]::new()

    foreach ($relative in $dockerfiles) {
      $stageAliases = [Collections.Generic.HashSet[string]]::new(
        [StringComparer]::OrdinalIgnoreCase)

      foreach ($line in Get-Content (Join-Path $Root $relative)) {
        if ($line -notmatch '^\s*FROM(?:\s+--platform=\S+)?\s+(?<image>\S+)(?:\s+AS\s+(?<alias>\S+))?\s*$') {
          continue
        }

        $image = $Matches.image
        $alias = $Matches.alias
        if (-not $stageAliases.Contains($image) -and
            $image -notmatch '@sha256:[a-f0-9]{64}$') {
          $mutableReferences.Add("${relative}: $image")
        }

        if ($alias) {
          [void]$stageAliases.Add($alias)
        }
      }
    }

    $mutableReferences | Should -BeNullOrEmpty
  }
}

Describe 'Preflight script syntax' {
  It 'parses capacity and feasibility collectors without errors' {
    foreach ($relative in 'ops/gcp/audit-migration-capacity.ps1','ops/gcp/benchmark-feasibility.ps1') {
      $tokens = $null
      $errors = $null
      [Management.Automation.Language.Parser]::ParseFile(
        (Join-Path $Root $relative), [ref]$tokens, [ref]$errors) | Out-Null
      @($errors).Count | Should -Be 0
    }
  }

  It 'uses a unique benchmark container and never removes a pre-existing fixed name' {
    $source = Get-Content (Join-Path $Root 'ops/gcp/benchmark-feasibility.ps1') -Raw
    $source | Should -Match "\[guid\]::NewGuid\(\)"
    $source | Should -Not -Match '(?m)^\s*& \$docker\.Source rm -f \$container \*> \$null\s*$'
  }

  It 'binds the retained image footprint to an approved official pricing snapshot' {
    $source = Get-Content (Join-Path $Root 'ops/gcp/benchmark-feasibility.ps1') -Raw
    $source | Should -Match 'DOC_AI_ARTIFACT_REGISTRY_PRICING_JSON'
    $source | Should -Match 'Get-ArtifactRegistryMonthlyCostEstimate'
    $source | Should -Match 'recurringCost'
    $source | Should -Match 'zeroCostFeasible'
  }
}
