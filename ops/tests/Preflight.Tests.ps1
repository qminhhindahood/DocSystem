BeforeAll {
  $Root = Split-Path $PSScriptRoot -Parent | Split-Path -Parent
  Import-Module (Join-Path $Root 'ops/lib/PreflightPolicy.psm1') -Force
}

Describe 'Preflight decision' {
  It 'returns NO_GO when any mandatory check is not passed' {
    $decision = New-PreflightDecision -Checks @(
      @{ name = 'images'; status = 'passed' },
      @{ name = 'embeddings'; status = 'failed' }
    ) -MigrationCostUsd 0 -NonZeroCostApproved:$false `
      -RecurringCostUsd 0 -RecurringCostApproved:$false
    $decision.decision | Should -Be 'NO_GO'
  }

  It 'requires explicit approval for a nonzero migration estimate' {
    $checks = 'pricing','capacity','images','neon-region','embeddings','database-restore',
      'storage-inventory','legacy-transition' | ForEach-Object { @{ name = $_; status = 'passed' } }
    (New-PreflightDecision -Checks $checks -MigrationCostUsd 0.01 `
      -NonZeroCostApproved:$false -RecurringCostUsd 0 `
      -RecurringCostApproved:$false).decision | Should -Be 'NO_GO'
  }

  It 'preserves an unknown cost as null and blocks' {
    $checks = 'pricing','capacity','images','neon-region','embeddings','database-restore',
      'storage-inventory','legacy-transition' | ForEach-Object { @{ name = $_; status = 'passed' } }
    $decision = New-PreflightDecision -Checks $checks -MigrationCostUsd $null `
      -NonZeroCostApproved:$false -RecurringCostUsd 0 -RecurringCostApproved:$false
    $decision.decision | Should -Be 'NO_GO'
    $decision.migrationCostUsd | Should -BeNullOrEmpty
  }

  It 'returns GO only when every mandatory check and recovery rehearsal pass' {
    $checks = 'pricing','capacity','images','neon-region','embeddings','database-restore',
      'storage-inventory','legacy-transition' | ForEach-Object { @{ name = $_; status = 'passed' } }
    (New-PreflightDecision -Checks $checks -MigrationCostUsd 0 `
      -NonZeroCostApproved:$false -RecurringCostUsd 0 `
      -RecurringCostApproved:$false).decision | Should -Be 'GO'
  }

  It 'requires a successful legacy transition inventory before GO' {
    $checks = 'pricing','capacity','images','neon-region','embeddings','database-restore',
      'storage-inventory' | ForEach-Object { @{ name = $_; status = 'passed' } }
    (New-PreflightDecision -Checks $checks -MigrationCostUsd 0 `
      -NonZeroCostApproved:$false -RecurringCostUsd 0 `
      -RecurringCostApproved:$false).decision | Should -Be 'NO_GO'

    $checks += @{ name = 'legacy-transition'; status = 'blocked' }
    (New-PreflightDecision -Checks $checks -MigrationCostUsd 0 `
      -NonZeroCostApproved:$false -RecurringCostUsd 0 `
      -RecurringCostApproved:$false).decision | Should -Be 'NO_GO'
  }

  It 'requires an approved amount to exactly match a nonzero estimate' {
    $checks = 'pricing','capacity','images','neon-region','embeddings','database-restore',
      'storage-inventory','legacy-transition' | ForEach-Object { @{ name = $_; status = 'passed' } }
    (New-PreflightDecision -Checks $checks -MigrationCostUsd 0.02 `
      -NonZeroCostApproved:$true -ApprovedMigrationCostUsd 0.01 `
      -RecurringCostUsd 0 -RecurringCostApproved:$false).decision | Should -Be 'NO_GO'
    (New-PreflightDecision -Checks $checks -MigrationCostUsd 0.02 `
      -NonZeroCostApproved:$true -ApprovedMigrationCostUsd 0.02 `
      -RecurringCostUsd 0 -RecurringCostApproved:$false).decision | Should -Be 'GO'
  }

  It 'requires a recurring-cost approval cap at or above the known estimate' {
    $checks = 'pricing','capacity','images','neon-region','embeddings','database-restore',
      'storage-inventory','legacy-transition' | ForEach-Object { @{ name = $_; status = 'passed' } }
    (New-PreflightDecision -Checks $checks -MigrationCostUsd 0 `
      -NonZeroCostApproved:$false -RecurringCostUsd 0.36 `
      -RecurringCostApproved:$true -ApprovedRecurringCostCapUsd 0.35).decision |
      Should -Be 'NO_GO'
    $decision = New-PreflightDecision -Checks $checks -MigrationCostUsd 0 `
      -NonZeroCostApproved:$false -RecurringCostUsd 0.36 `
      -RecurringCostApproved:$true -ApprovedRecurringCostCapUsd 0.50
    $decision.decision | Should -Be 'GO'
    $decision.zeroCostFeasible | Should -BeFalse
    $decision.recurringCostApproved | Should -BeTrue
    $decision.approvedRecurringCostCapUsd | Should -Be 0.50
  }

  It 'blocks an unknown recurring cost even when approval is requested' {
    $checks = 'pricing','capacity','images','neon-region','embeddings','database-restore',
      'storage-inventory','legacy-transition' | ForEach-Object { @{ name = $_; status = 'passed' } }
    (New-PreflightDecision -Checks $checks -MigrationCostUsd 0 `
      -NonZeroCostApproved:$false -RecurringCostUsd $null `
      -RecurringCostApproved:$true -ApprovedRecurringCostCapUsd 1).decision |
      Should -Be 'NO_GO'
  }

  It 'accepts only success and reviewable NO_GO child exit codes' {
    { Assert-PreflightChildExitCode -ExitCode 0 -ScriptName 'collector' } | Should -Not -Throw
    { Assert-PreflightChildExitCode -ExitCode 2 -ScriptName 'collector' } | Should -Not -Throw
    { Assert-PreflightChildExitCode -ExitCode 1 -ScriptName 'collector' } |
      Should -Throw '*configuration error*'
  }
}

Describe 'Preflight orchestrator contract' {
  It 'parses without errors' {
    $tokens = $null; $errors = $null
    [Management.Automation.Language.Parser]::ParseFile(
      (Join-Path $Root 'ops/gcp/invoke-preflight.ps1'), [ref]$tokens, [ref]$errors) | Out-Null
    @($errors).Count | Should -Be 0
  }

  It 'documents the migration-rate input needed for a known cost' {
    Get-Content (Join-Path $Root 'docs/operations/gcp-production-runbook.md') -Raw |
      Should -Match 'DOC_AI_MIGRATION_PRICING_JSON'
  }

  It 'makes GO schema-invalid when embedding feasibility is false' {
    $schema = Join-Path $Root 'ops/schemas/preflight-decision.schema.json'
    $document = [ordered]@{
      schemaVersion = 2; releaseSha = ('a' * 40); createdAt = [datetime]::UtcNow.ToString('o')
      decision = 'GO'; selectedNeonRegion = 'aws-us-east-2'; embeddingFeasible = $false
      migrationCostUsd = 0; nonZeroCostApproved = $false
      recurringCostUsd = 0; recurringCostApproved = $false
      approvedRecurringCostCapUsd = $null; zeroCostFeasible = $true
      capacityEvidence = @{ path = '.artifacts/releases/a/capacity.json'; sha256 = ('b' * 64) }
      checks = @(@{ name = 'all'; status = 'passed'; reason = $null })
      evidence = @(@{ path = '.artifacts/releases/a/evidence.json'; sha256 = ('c' * 64) })
    } | ConvertTo-Json -Depth 10
    Test-Json -Json $document -SchemaFile $schema -ErrorAction SilentlyContinue | Should -BeFalse
  }

  It 'makes a nonzero recurring-cost GO schema-invalid without explicit approval' {
    $schema = Join-Path $Root 'ops/schemas/preflight-decision.schema.json'
    $document = [ordered]@{
      schemaVersion = 2; releaseSha = ('a' * 40); createdAt = [datetime]::UtcNow.ToString('o')
      decision = 'GO'; selectedNeonRegion = 'aws-us-east-2'; embeddingFeasible = $true
      migrationCostUsd = 0; nonZeroCostApproved = $false
      recurringCostUsd = 0.36; recurringCostApproved = $false
      approvedRecurringCostCapUsd = $null; zeroCostFeasible = $false
      capacityEvidence = @{ path = '.artifacts/releases/a/capacity.json'; sha256 = ('b' * 64) }
      checks = @(@{ name = 'all'; status = 'passed'; reason = $null })
      evidence = @(@{ path = '.artifacts/releases/a/evidence.json'; sha256 = ('c' * 64) })
    } | ConvertTo-Json -Depth 10
    Test-Json -Json $document -SchemaFile $schema -ErrorAction SilentlyContinue | Should -BeFalse
  }

  It 'accepts a GO with a known recurring cost inside its explicit approval cap' {
    $schema = Join-Path $Root 'ops/schemas/preflight-decision.schema.json'
    $document = [ordered]@{
      schemaVersion = 2; releaseSha = ('a' * 40); createdAt = [datetime]::UtcNow.ToString('o')
      decision = 'GO'; selectedNeonRegion = 'aws-us-east-2'; embeddingFeasible = $true
      migrationCostUsd = 0; nonZeroCostApproved = $false
      recurringCostUsd = 0.36; recurringCostApproved = $true
      approvedRecurringCostCapUsd = 0.50; zeroCostFeasible = $false
      capacityEvidence = @{ path = '.artifacts/releases/a/capacity.json'; sha256 = ('b' * 64) }
      checks = @(@{ name = 'all'; status = 'passed'; reason = $null })
      evidence = @(@{ path = '.artifacts/releases/a/evidence.json'; sha256 = ('c' * 64) })
    } | ConvertTo-Json -Depth 10
    Test-Json -Json $document -SchemaFile $schema -ErrorAction SilentlyContinue | Should -BeTrue
  }

  It 'requires the orchestrator to carry the recurring-cost gate into the decision' {
    $source = Get-Content (Join-Path $Root 'ops/gcp/invoke-preflight.ps1') -Raw
    $source | Should -Match 'ApproveRecurringCost'
    $source | Should -Match 'ApprovedRecurringCostCapUsd'
    $source | Should -Match 'RecurringCostUsd'
    $source | Should -Match 'zeroCostFeasible'
  }

  It 'produces target projection inputs before running the capacity collector' {
    $source = Get-Content (Join-Path $Root 'ops/gcp/invoke-preflight.ps1') -Raw
    $benchmark = $source.IndexOf("'benchmark-feasibility.ps1'")
    $inventory = $source.IndexOf("'inventory-storage.ps1'")
    $capacity = $source.IndexOf("'audit-migration-capacity.ps1'")
    $benchmark | Should -BeGreaterOrEqual 0
    $inventory | Should -BeGreaterThan $benchmark
    $capacity | Should -BeGreaterThan $inventory
  }

  It 'makes legacy transition inventory status a mandatory decision check' {
    $source = Get-Content (Join-Path $Root 'ops/gcp/invoke-preflight.ps1') -Raw
    $source | Should -Match "name='legacy-transition'"
    $source | Should -Match 'Get-JsonStatus \$legacyTransitionPath'
  }

  It 'schema-validates capacity evidence before reading records into the decision' {
    $source = Get-Content (Join-Path $Root 'ops/gcp/invoke-preflight.ps1') -Raw
    $schemaCheck = $source.IndexOf("'ops/schemas/capacity-evidence.schema.json'")
    $recordRead = $source.IndexOf('Test-PreflightCapacityAcceptance')
    $schemaCheck | Should -BeGreaterOrEqual 0
    $recordRead | Should -BeGreaterThan $schemaCheck
    $source | Should -Match 'Capacity snapshot does not validate against CapacityEvidenceV2'
  }
}
