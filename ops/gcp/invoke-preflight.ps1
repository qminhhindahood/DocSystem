#!/usr/bin/env pwsh
[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')][string]$ProjectId,
  [Parameter(Mandatory)][string]$BillingAccountId,
  [Parameter(Mandatory)][ValidateSet('asia-southeast1')][string]$SourceRegion,
  [Parameter(Mandatory)][ValidateSet('us-central1')][string]$TargetRegion,
  [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$ReleaseSha,
  [Parameter(Mandatory)][string]$AgeRecipient,
  [Parameter(Mandatory)][string]$EvidenceDirectory,
  [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$PricingApprovalSha256,
  [AllowNull()][decimal]$ApprovedMigrationCostUsd,
  [switch]$ApproveNonZeroMigrationCost,
  [AllowNull()][decimal]$ApprovedRecurringCostCapUsd,
  [switch]$ApproveRecurringCost,
  [switch]$ExecuteRehearsal
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Import-Module (Join-Path $Root 'ops/lib/Evidence.psm1') -Force
Import-Module (Join-Path $Root 'ops/lib/PreflightPolicy.psm1') -Force
$Config = Get-Content (Join-Path $Root 'ops/config/zero-cost-ceilings.json') -Raw |
  ConvertFrom-Json -AsHashtable
$EvidenceDirectory = Resolve-EvidencePath $EvidenceDirectory $Root
New-Item -ItemType Directory -Force $EvidenceDirectory | Out-Null
$DecisionPath = Join-Path $EvidenceDirectory 'preflight-decision.json'

foreach ($tool in 'git','pwsh','docker','gcloud') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Required preflight tool is unavailable: $tool" }
}
if ($ExecuteRehearsal) {
  foreach ($tool in 'psql','pg_dump','pg_restore','age') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Required recovery tool is unavailable: $tool" }
  }
}
if ($env:DOC_AI_BILLING_ACCOUNT_ID -ne $BillingAccountId) {
  throw 'DOC_AI_BILLING_ACCOUNT_ID must match the requested billing account'
}
if ($AgeRecipient -notmatch '^age1[0-9a-z]{20,}$') { throw 'Age recipient is invalid' }
$oldAgeRecipient = $env:DOC_AI_AGE_RECIPIENT
$env:DOC_AI_AGE_RECIPIENT = $AgeRecipient

function Invoke-ChildScript([string]$Script, [string[]]$Arguments) {
  & pwsh -NoProfile -File $Script @Arguments
  $exitCode = $LASTEXITCODE
  Assert-PreflightChildExitCode -ExitCode $exitCode -ScriptName (Split-Path $Script -Leaf)
  return $exitCode
}

function Get-JsonStatus([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return 'blocked' }
  try { return [string](Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json).status }
  catch { return 'blocked' }
}

try {
  [void](Invoke-ChildScript (Join-Path $PSScriptRoot 'benchmark-feasibility.ps1') @(
      '-ReleaseSha',$ReleaseSha,'-EvidenceDirectory',$EvidenceDirectory))
  [void](Invoke-ChildScript (Join-Path $PSScriptRoot 'inventory-storage.ps1') @(
      '-ProjectId',$ProjectId,'-SourceRegion',$SourceRegion,
      '-TemplatesBucket',"docai-templates-$ProjectId",'-UploadsBucket',"docai-uploads-$ProjectId",
      '-RagStateBucket',"docai-rag-state-$ProjectId",'-ReleaseSha',$ReleaseSha,
      '-EvidenceDirectory',$EvidenceDirectory))
  $auditArgs = @('-ProjectId',$ProjectId,'-BillingAccountId',$BillingAccountId,'-ReleaseSha',$ReleaseSha,
    '-EvidenceDirectory',$EvidenceDirectory,'-PricingApprovalSha256',$PricingApprovalSha256,'-Mode','Preflight')
  if ($ApproveRecurringCost) {
    $auditArgs += @('-ApproveRecurringCost','-ApprovedRecurringCostCapUsd',
      [string]$ApprovedRecurringCostCapUsd)
  }
  [void](Invoke-ChildScript (Join-Path $PSScriptRoot 'audit-migration-capacity.ps1') $auditArgs)

  $restorePath = Join-Path $EvidenceDirectory 'restore-evidence.json'
  $verificationPath = Join-Path $EvidenceDirectory 'restore-verification.json'
  if ($ExecuteRehearsal) {
    if (-not $env:DOC_AI_QUIESCENCE_EVIDENCE_PATH) {
      throw 'DOC_AI_QUIESCENCE_EVIDENCE_PATH is required for the restore rehearsal'
    }
    $dumpDirectory = Join-Path $EvidenceDirectory 'database-backup'
    [void](Invoke-ChildScript (Join-Path $Root 'ops/backup-postgres.ps1') @(
        '-OutputDir',$dumpDirectory,'-QuiescenceEvidencePath',$env:DOC_AI_QUIESCENCE_EVIDENCE_PATH,'-Execute'))
    [void](Invoke-ChildScript (Join-Path $PSScriptRoot 'restore-to-neon.ps1') @(
        '-DumpDirectory',$dumpDirectory,'-QuiescenceEvidencePath',$env:DOC_AI_QUIESCENCE_EVIDENCE_PATH,
        '-ReleaseSha',$ReleaseSha,'-EvidenceDirectory',$EvidenceDirectory,'-Execute'))
    if ((Get-JsonStatus $restorePath) -eq 'passed') {
      [void](Invoke-ChildScript (Join-Path $PSScriptRoot 'verify-neon-restore.ps1') @(
          '-SourceManifestPath',(Join-Path $dumpDirectory 'manifest.json'),'-ReleaseSha',$ReleaseSha,
          '-EvidenceDirectory',$EvidenceDirectory))
    }
  } else {
    $dumpDirectory = if ($env:DOC_AI_PREFLIGHT_DUMP_DIRECTORY) {
      $env:DOC_AI_PREFLIGHT_DUMP_DIRECTORY
    } else { Join-Path $EvidenceDirectory 'database-backup' }
    $quiescence = if ($env:DOC_AI_QUIESCENCE_EVIDENCE_PATH) {
      $env:DOC_AI_QUIESCENCE_EVIDENCE_PATH
    } else { Join-Path $EvidenceDirectory 'missing-quiescence.json' }
    if ((Test-Path $dumpDirectory) -and (Test-Path $quiescence)) {
      [void](Invoke-ChildScript (Join-Path $PSScriptRoot 'restore-to-neon.ps1') @(
          '-DumpDirectory',$dumpDirectory,'-QuiescenceEvidencePath',$quiescence,
          '-ReleaseSha',$ReleaseSha,'-EvidenceDirectory',$EvidenceDirectory))
    } else {
      Write-EvidenceJson $restorePath ([ordered]@{
          schemaVersion = 1; releaseSha = $ReleaseSha; status = 'preview'; targetIdentityHash = $null
          startedAt = [datetime]::UtcNow.ToString('o'); completedAt = $null; migrationCount = $null
          importDurationMs = $null; safeError = 'EXECUTE_REHEARSAL_REQUIRED'
        })
    }
  }

  $capacityPath = Join-Path $EvidenceDirectory 'capacity-snapshot.json'
  if (-not (Test-Path -LiteralPath $capacityPath)) { throw 'Capacity snapshot was not produced' }
  $capacityJson = Get-Content -LiteralPath $capacityPath -Raw
  if (-not (Test-Json -Json $capacityJson `
      -SchemaFile (Join-Path $Root 'ops/schemas/capacity-evidence.schema.json') `
      -ErrorAction Stop)) {
    throw 'Capacity snapshot does not validate against CapacityEvidenceV2'
  }
  $capacity = $capacityJson | ConvertFrom-Json
  $imagesPath = Join-Path $EvidenceDirectory 'image-footprint.json'
  $regionsPath = Join-Path $EvidenceDirectory 'neon-region-benchmark.json'
  $embeddingsPath = Join-Path $EvidenceDirectory 'embeddings-benchmark.json'
  $storagePath = Join-Path $EvidenceDirectory 'source-storage-summary.json'
  $costPath = Join-Path $EvidenceDirectory 'migration-cost-estimate.json'
  $pricingPath = Join-Path $EvidenceDirectory 'pricing-revalidation.json'
  $legacyTransitionPath = Join-Path $EvidenceDirectory 'legacy-transition-capacity.json'
  $regions = if (Test-Path $regionsPath) { Get-Content $regionsPath -Raw | ConvertFrom-Json } else { $null }
  $images = if (Test-Path $imagesPath) { Get-Content $imagesPath -Raw | ConvertFrom-Json } else { $null }
  $embeddings = if (Test-Path $embeddingsPath) { Get-Content $embeddingsPath -Raw | ConvertFrom-Json } else { $null }
  $cost = if (Test-Path $costPath) { Get-Content $costPath -Raw | ConvertFrom-Json } else { $null }
  $pricingApproved = (Test-Path $pricingPath) -and
    (Get-EvidenceSha256 $pricingPath) -eq $PricingApprovalSha256 -and
    @((Get-Content $pricingPath -Raw | ConvertFrom-Json).sources | Where-Object status -ne 'passed').Count -eq 0
  $migrationCost = if ($cost -and $cost.ratesKnown) { [decimal]$cost.migrationCostUsd } else { $null }
  $recurringCost = if ($images -and $images.recurringCost.ratesKnown) {
    [decimal]$images.recurringCost.monthlyCostUsd
  } else {
    $null
  }
  $capacityAcceptance = Test-PreflightCapacityAcceptance -CapacityEvidence $capacity `
    -ReleaseSha $ReleaseSha -ExpectedMetrics @($Config.metrics.Keys) -RecurringCostUsd $recurringCost `
    -RecurringCostApproved:$ApproveRecurringCost `
    -ApprovedRecurringCostCapUsd $ApprovedRecurringCostCapUsd

  $checks = @(
    [ordered]@{ name='pricing'; status=if($pricingApproved){'passed'}else{'blocked'}; reason=if($pricingApproved){$null}else{'PRICING_APPROVAL_REQUIRED'} },
    [ordered]@{ name='capacity'; status=$capacityAcceptance.status; reason=$capacityAcceptance.reason },
    [ordered]@{ name='images'; status=if((Get-JsonStatus $imagesPath) -eq 'passed'){'passed'}else{'blocked'}; reason=if((Get-JsonStatus $imagesPath) -eq 'passed'){$null}else{'IMAGE_GATE_BLOCKED'} },
    [ordered]@{ name='neon-region'; status=if($regions.status -eq 'passed'){'passed'}else{'blocked'}; reason=if($regions.status -eq 'passed'){$null}else{'NEON_REGION_GATE_BLOCKED'} },
    [ordered]@{ name='embeddings'; status=if($embeddings.status -eq 'passed'){'passed'}else{'blocked'}; reason=if($embeddings.status -eq 'passed'){$null}else{'EMBEDDING_GATE_BLOCKED'} },
    [ordered]@{ name='database-restore'; status=if((Get-JsonStatus $restorePath) -eq 'passed' -and (Get-JsonStatus $verificationPath) -eq 'passed'){'passed'}else{'blocked'}; reason=if((Get-JsonStatus $restorePath) -eq 'passed' -and (Get-JsonStatus $verificationPath) -eq 'passed'){$null}else{'RESTORE_REHEARSAL_REQUIRED'} },
    [ordered]@{ name='storage-inventory'; status=if((Test-Path $storagePath) -and $cost){'passed'}else{'blocked'}; reason=if((Test-Path $storagePath) -and $cost){$null}else{'STORAGE_INVENTORY_BLOCKED'} },
    [ordered]@{ name='legacy-transition'; status=if((Get-JsonStatus $legacyTransitionPath) -eq 'passed'){'passed'}else{'blocked'}; reason=if((Get-JsonStatus $legacyTransitionPath) -eq 'passed'){$null}else{'LEGACY_TRANSITION_INVENTORY_BLOCKED'} }
  )
  $decisionCore = New-PreflightDecision -Checks $checks -MigrationCostUsd $migrationCost `
    -NonZeroCostApproved:$ApproveNonZeroMigrationCost `
    -ApprovedMigrationCostUsd $ApprovedMigrationCostUsd `
    -RecurringCostUsd $recurringCost -RecurringCostApproved:$ApproveRecurringCost `
    -ApprovedRecurringCostCapUsd $ApprovedRecurringCostCapUsd

  $evidence = @()
  foreach ($file in Get-ChildItem -LiteralPath $EvidenceDirectory -File -Recurse | Sort-Object FullName) {
    if ($file.FullName -eq $DecisionPath) { continue }
    $evidence += [ordered]@{
      path = [IO.Path]::GetRelativePath($Root, $file.FullName).Replace('\','/')
      sha256 = Get-EvidenceSha256 $file.FullName
    }
  }
  if ($evidence.Count -eq 0) { throw 'No preflight evidence was produced' }
  $document = [ordered]@{
    schemaVersion = 2; releaseSha = $ReleaseSha; createdAt = [datetime]::UtcNow.ToString('o')
    decision = $decisionCore.decision
    selectedNeonRegion = if ($regions -and $regions.selectedRegion) { [string]$regions.selectedRegion } else { 'aws-us-east-2' }
    embeddingFeasible = [bool]($embeddings -and $embeddings.embeddingFeasible)
    migrationCostUsd = $decisionCore.migrationCostUsd
    nonZeroCostApproved = $decisionCore.nonZeroCostApproved
    recurringCostUsd = $decisionCore.recurringCostUsd
    recurringCostApproved = $decisionCore.recurringCostApproved
    approvedRecurringCostCapUsd = $decisionCore.approvedRecurringCostCapUsd
    zeroCostFeasible = $decisionCore.zeroCostFeasible
    capacityEvidence = [ordered]@{
      path = [IO.Path]::GetRelativePath($Root, $capacityPath).Replace('\','/')
      sha256 = Get-EvidenceSha256 $capacityPath
    }
    checks = $checks; evidence = $evidence
  }
  Write-EvidenceJson $DecisionPath $document
  if (-not (Test-Json -Json (Get-Content $DecisionPath -Raw) `
      -SchemaFile (Join-Path $Root 'ops/schemas/preflight-decision.schema.json') -ErrorAction Stop)) {
    throw 'Preflight decision does not validate against PreflightDecisionV2'
  }
  Assert-EvidenceContainsNoSecrets $EvidenceDirectory
  if ($document.decision -eq 'GO') { exit 0 }
  exit 2
} finally {
  $env:DOC_AI_AGE_RECIPIENT = $oldAgeRecipient
}
