BeforeAll {
  $Root = Split-Path $PSScriptRoot -Parent | Split-Path -Parent
  Import-Module (Join-Path $Root 'ops/lib/PreflightPolicy.psm1') -Force
  Import-Module (Join-Path $Root 'ops/lib/BoundedProcess.psm1') -Force
}

Describe 'Zero-cost capacity policy' {
  $cases = @(
    @{ metric = 'artifactRegistryBytes'; policy = 'hard_limit'; value = 419430401; ceiling = 419430400 },
    @{ metric = 'gcsBytes'; policy = 'progressive'; value = 3758096385; ceiling = 3758096384 },
    @{ metric = 'neonCuHours'; policy = 'progressive'; value = 70.01; ceiling = 70 },
    @{ metric = 'cloudTasksOperations'; policy = 'progressive'; value = 700001; ceiling = 700000 }
  )

  It 'marks <metric> over its internal ceiling as blocking' -ForEach $cases {
    $result = Test-CapacityMetric -Metric $metric -Policy $policy `
      -Value $value -Ceiling $ceiling
    $result.status | Should -Be 'blocked'
    $result.ratio | Should -BeGreaterThan 1
  }

  It 'blocks an absent authoritative observation' {
    $result = Test-CapacityMetric -Metric 'loggingBytes' -Policy progressive `
      -Value $null -Ceiling 37580963840
    $result.status | Should -Be 'blocked'
    $result.safeCollectionError | Should -Not -BeNullOrEmpty
  }

  It 'allows the exact intended binary hard limit' {
    $result = Test-CapacityMetric -Metric 'secretManagerActiveVersions' `
      -Policy hard_limit -Value 5 -Ceiling 5
    $result.status | Should -Be 'passed'
    $result.ratio | Should -Be 1.0
  }

  It 'blocks negative and non-finite observations' {
    foreach ($value in @(-1, [double]::NaN, [double]::PositiveInfinity)) {
      (Test-CapacityMetric -Metric invalid -Policy progressive -Value $value -Ceiling 10).status |
        Should -Be 'blocked'
    }
  }

  It 'defines all 24 exact design metrics with the intended five hard limits' {
    $config = Get-Content (Join-Path $Root 'ops/config/zero-cost-ceilings.json') -Raw |
      ConvertFrom-Json -AsHashtable
    $config.metrics.Count | Should -Be 24
    @($config.metrics.GetEnumerator() | Where-Object { $_.Value.policy -eq 'hard_limit' }).Count |
      Should -Be 5
  }
}

Describe 'Capacity record construction' {
  It 'hashes the account identity and never emits its raw value' {
    $record = New-CapacityRecord -Metric gcsBytes -Policy progressive -Value 1 `
      -Unit bytes -Ceiling 10 -OfficialAllowance 20 -SafeSourceName cloud-monitoring `
      -AccountIdentity 'billingAccounts/secret-id' -ObservedAt ([datetime]'2026-08-15T00:00:00Z') `
      -ValidUntil ([datetime]'2026-08-15T06:00:00Z') -ReleaseSha ('a' * 40)
    $record.accountIdentityHash | Should -Match '^[a-f0-9]{64}$'
    ($record | ConvertTo-Json -Compress) | Should -Not -Match 'secret-id'
    $record.status | Should -Be 'passed'
  }

  It 'allows an over-ceiling blocked record to retain its diagnostic ratio' {
    $observed = [datetime]'2026-08-15T00:00:00Z'
    $record = New-CapacityRecord -Metric gcsBytes -Policy progressive -Value 11 `
      -Unit bytes -Ceiling 10 -OfficialAllowance $null -SafeSourceName cloud-monitoring `
      -AccountIdentity 'billing-account' -ObservedAt $observed -ValidUntil $observed.AddHours(6) `
      -ReleaseSha ('a' * 40)
    $document = [ordered]@{
      schemaVersion = 2; releaseSha = ('a' * 40); mode = 'preflight_projection'
      status = 'blocked'; zeroCostFeasible = $false
      createdAt = $observed.ToString('o'); validUntil = $observed.AddHours(6).ToString('o')
      records = @($record)
    } | ConvertTo-Json -Depth 20
    $valid = Test-Json -Json $document `
      -SchemaFile (Join-Path $Root 'ops/schemas/capacity-evidence.schema.json') -ErrorAction Stop
    $valid | Should -BeTrue
  }

  It 'accepts only an Artifact Registry overage inside a known approved monthly cap' {
    $observed = [datetime]'2026-08-15T00:00:00Z'
    $exception = [ordered]@{
      kind = 'artifact_registry_recurring_cost_cap'
      estimatedMonthlyCostUsd = 0.36
      approvedMonthlyCapUsd = 0.50
      pricingSourceSha256 = 'b' * 64
    }
    $record = New-CapacityRecord -Metric artifactRegistryBytes -Policy hard_limit `
      -Value 4390931158 -Unit bytes -Ceiling 419430400 -OfficialAllowance 536870912 `
      -SafeSourceName ('preflight-projection:image-footprint-sha256:' + ('a' * 64)) `
      -AccountIdentity 'billing-account' -ObservedAt $observed `
      -ValidUntil $observed.AddHours(6) -ReleaseSha ('a' * 40) `
      -ApprovedException $exception
    $record.status | Should -Be 'passed'
    $record.zeroCostStatus | Should -Be 'blocked'
    $record.ratio | Should -BeGreaterThan 1
    $record.safeCollectionError | Should -BeNullOrEmpty
    $record.approvedException.approvedMonthlyCapUsd | Should -Be 0.50
  }

  It 'rejects an exception for another metric or below the estimated cost' {
    $observed = [datetime]'2026-08-15T00:00:00Z'
    $exception = [ordered]@{
      kind = 'artifact_registry_recurring_cost_cap'; estimatedMonthlyCostUsd = 0.36
      approvedMonthlyCapUsd = 0.35; pricingSourceSha256 = 'b' * 64
    }
    { New-CapacityRecord -Metric gcsBytes -Policy progressive -Value 11 -Unit bytes `
        -Ceiling 10 -OfficialAllowance 20 -SafeSourceName projection `
        -AccountIdentity billing -ObservedAt $observed -ValidUntil $observed.AddHours(6) `
        -ReleaseSha ('a' * 40) -ApprovedException $exception } | Should -Throw '*Artifact Registry*'
    { New-CapacityRecord -Metric artifactRegistryBytes -Policy hard_limit -Value 11 -Unit bytes `
        -Ceiling 10 -OfficialAllowance 20 -SafeSourceName projection `
        -AccountIdentity billing -ObservedAt $observed -ValidUntil $observed.AddHours(6) `
        -ReleaseSha ('a' * 40) -ApprovedException $exception } | Should -Throw '*cap*'
  }
}

Describe 'Preflight target-capacity projection' {
  It 'uses release-bound target image, storage, and five-bundle evidence' {
    $release = 'a' * 40
    $projection = Get-PreflightCapacityProjection -ReleaseSha $release `
      -ImageFootprint @{
        schemaVersion = 1; releaseSha = $release; status = 'passed'
        retainedBytes = 4390931158; retentionCopies = 2
      } -StorageSummary @{
        schemaVersion = 1; releaseSha = $release; projectedTargetLiveBytes = 26242595
      } -ProjectedSecretVersionCount 5
    $projection.artifactRegistryBytes | Should -Be 4390931158
    $projection.gcsBytes | Should -Be 26242595
    $projection.secretManagerActiveVersions | Should -Be 5
  }

  It 'rejects blocked, wrong-release, malformed, or non-five-bundle projections' {
    $release = 'a' * 40
    $image = @{ schemaVersion = 1; releaseSha = $release; status = 'passed'; retainedBytes = 10; retentionCopies = 2 }
    $storage = @{ schemaVersion = 1; releaseSha = $release; projectedTargetLiveBytes = 20 }
    $blockedImage = $image.Clone(); $blockedImage.status = 'blocked'
    $wrongStorage = $storage.Clone(); $wrongStorage.releaseSha = 'b' * 40
    { Get-PreflightCapacityProjection -ReleaseSha $release -ImageFootprint $blockedImage `
        -StorageSummary $storage -ProjectedSecretVersionCount 5 } | Should -Throw '*image*'
    { Get-PreflightCapacityProjection -ReleaseSha $release -ImageFootprint $image `
        -StorageSummary $wrongStorage -ProjectedSecretVersionCount 5 } |
      Should -Throw '*release*'
    { Get-PreflightCapacityProjection -ReleaseSha $release -ImageFootprint $image `
        -StorageSummary $storage -ProjectedSecretVersionCount 6 } | Should -Throw '*five*'
  }

  It 'requires the live collector to separate projection from legacy transition debt' {
    $source = Get-Content (Join-Path $Root 'ops/gcp/audit-migration-capacity.ps1') -Raw
    $source | Should -Match 'Get-PreflightCapacityProjection'
    $source | Should -Match 'legacy-transition-capacity\.json'
    $source | Should -Match 'image-footprint\.json'
    $source | Should -Match 'source-storage-summary\.json'
  }
}

Describe 'Preflight capacity acceptance with bounded recurring cost' {
  BeforeEach {
    $script:release = 'a' * 40
    $script:records = @(
      [pscustomobject]@{
        metric = 'artifactRegistryBytes'; policy = 'hard_limit'; measuredValue = 4390931158
        ratio = 10.47; source = 'preflight-projection:image-footprint-sha256:' + ('a' * 64)
        safeCollectionError = $null; status = 'passed'; zeroCostStatus = 'blocked'
        approvedException = [pscustomobject]@{
          kind = 'artifact_registry_recurring_cost_cap'; estimatedMonthlyCostUsd = 0.36
          approvedMonthlyCapUsd = 0.50; pricingSourceSha256 = 'b' * 64
        }
      },
      [pscustomobject]@{
        metric = 'gcsBytes'; policy = 'progressive'; measuredValue = 100
        ratio = 0.01; source = 'preflight-projection:storage-summary-sha256:' + ('b' * 64)
        safeCollectionError = $null; status = 'passed'; zeroCostStatus = 'passed'
        approvedException = $null
      }
    )
    $script:capacity = [pscustomobject]@{
      schemaVersion = 2; releaseSha = $release; mode = 'preflight_projection'
      status = 'passed'; zeroCostFeasible = $false; records = $records
    }
  }

  It 'accepts only the projected artifact overage inside an explicit recurring-cost cap' {
    $result = Test-PreflightCapacityAcceptance -CapacityEvidence $capacity -ReleaseSha $release `
      -ExpectedMetrics @('artifactRegistryBytes','gcsBytes') -RecurringCostUsd 0.36 `
      -RecurringCostApproved:$true -ApprovedRecurringCostCapUsd 0.50
    $result.status | Should -Be 'passed'
    $result.zeroCostFeasible | Should -BeFalse
    $result.reason | Should -Be 'APPROVED_ARTIFACT_REGISTRY_RECURRING_COST'
  }

  It 'blocks a missing approval, insufficient cap, another failed metric, or progressive pressure' {
    (Test-PreflightCapacityAcceptance -CapacityEvidence $capacity -ReleaseSha $release `
      -ExpectedMetrics @('artifactRegistryBytes','gcsBytes') -RecurringCostUsd 0.36 `
      -RecurringCostApproved:$false -ApprovedRecurringCostCapUsd $null).status | Should -Be 'blocked'
    (Test-PreflightCapacityAcceptance -CapacityEvidence $capacity -ReleaseSha $release `
      -ExpectedMetrics @('artifactRegistryBytes','gcsBytes') -RecurringCostUsd 0.36 `
      -RecurringCostApproved:$true -ApprovedRecurringCostCapUsd 0.35).status | Should -Be 'blocked'
    $records[1].status = 'blocked'; $records[1].safeCollectionError = 'INTERNAL_CEILING_EXCEEDED'
    (Test-PreflightCapacityAcceptance -CapacityEvidence $capacity -ReleaseSha $release `
      -ExpectedMetrics @('artifactRegistryBytes','gcsBytes') -RecurringCostUsd 0.36 `
      -RecurringCostApproved:$true -ApprovedRecurringCostCapUsd 0.50).status | Should -Be 'blocked'
    $records[1].status = 'passed'; $records[1].safeCollectionError = $null; $records[1].ratio = 0.70
    (Test-PreflightCapacityAcceptance -CapacityEvidence $capacity -ReleaseSha $release `
      -ExpectedMetrics @('artifactRegistryBytes','gcsBytes') -RecurringCostUsd 0.36 `
      -RecurringCostApproved:$true -ApprovedRecurringCostCapUsd 0.50).status | Should -Be 'blocked'
  }

  It 'blocks wrong-release, runtime-mode, blocked, or zero-cost-inconsistent envelopes' {
    foreach ($mutation in @(
        @{ releaseSha = 'b' * 40 },
        @{ mode = 'runtime_actual' },
        @{ status = 'blocked' },
        @{ zeroCostFeasible = $true }
      )) {
      $candidate = $capacity.PSObject.Copy()
      foreach ($key in $mutation.Keys) { $candidate.$key = $mutation[$key] }
      (Test-PreflightCapacityAcceptance -CapacityEvidence $candidate -ReleaseSha $release `
        -ExpectedMetrics @('artifactRegistryBytes','gcsBytes') -RecurringCostUsd 0.36 `
        -RecurringCostApproved:$true -ApprovedRecurringCostCapUsd 0.50).status |
        Should -Be 'blocked'
    }
  }

  It 'requires the orchestrator to use the bounded capacity acceptance policy' {
    Get-Content (Join-Path $Root 'ops/gcp/invoke-preflight.ps1') -Raw |
      Should -Match 'Test-PreflightCapacityAcceptance'
  }
}

Describe 'CapacityEvidenceV2 envelope consistency' {
  BeforeAll {
    $script:capacitySchema = Join-Path $Root 'ops/schemas/capacity-evidence.schema.json'
    $script:observed = [datetime]'2026-08-15T00:00:00Z'
    $script:normalRecord = New-CapacityRecord -Metric gcsBytes -Policy progressive -Value 1 `
      -Unit bytes -Ceiling 10 -OfficialAllowance 20 -SafeSourceName monitoring `
      -AccountIdentity billing -ObservedAt $observed -ValidUntil $observed.AddHours(6) `
      -ReleaseSha ('a' * 40)
  }

  It 'rejects a passed envelope that contains a blocked record' {
    $blockedRecord = New-CapacityRecord -Metric neonBytes -Policy progressive -Value 11 `
      -Unit bytes -Ceiling 10 -OfficialAllowance 20 -SafeSourceName neon `
      -AccountIdentity neon -ObservedAt $observed -ValidUntil $observed.AddHours(6) `
      -ReleaseSha ('a' * 40)
    $document = [ordered]@{
      schemaVersion = 2; releaseSha = 'a' * 40; mode = 'preflight_projection'
      status = 'passed'; zeroCostFeasible = $false; createdAt = $observed.ToString('o')
      validUntil = $observed.AddHours(6).ToString('o'); records = @($normalRecord,$blockedRecord)
    } | ConvertTo-Json -Depth 20
    Test-Json -Json $document -SchemaFile $capacitySchema -ErrorAction SilentlyContinue |
      Should -BeFalse
  }

  It 'rejects zeroCostFeasible true when a record has a cost exception' {
    $exception = [ordered]@{
      kind = 'artifact_registry_recurring_cost_cap'; estimatedMonthlyCostUsd = 0.36
      approvedMonthlyCapUsd = 0.50; pricingSourceSha256 = 'b' * 64
    }
    $artifact = New-CapacityRecord -Metric artifactRegistryBytes -Policy hard_limit `
      -Value 4390931158 -Unit bytes -Ceiling 419430400 -OfficialAllowance 536870912 `
      -SafeSourceName projection -AccountIdentity billing -ObservedAt $observed `
      -ValidUntil $observed.AddHours(6) -ReleaseSha ('a' * 40) -ApprovedException $exception
    $document = [ordered]@{
      schemaVersion = 2; releaseSha = 'a' * 40; mode = 'preflight_projection'
      status = 'passed'; zeroCostFeasible = $true; createdAt = $observed.ToString('o')
      validUntil = $observed.AddHours(6).ToString('o'); records = @($artifact)
    } | ConvertTo-Json -Depth 20
    Test-Json -Json $document -SchemaFile $capacitySchema -ErrorAction SilentlyContinue |
      Should -BeFalse
  }
}

Describe 'Artifact Registry retained image accounting' {
  It 'sums authoritative repository sizeBytes across every repository format' {
    $measurement = Measure-ArtifactRepositoryBytes -Repositories @(
      [pscustomobject]@{
        name = 'projects/example-project/locations/us-central1/repositories/docker'
        format = 'DOCKER'; sizeBytes = '100'
      },
      [pscustomobject]@{
        name = 'projects/example-project/locations/us-central1/repositories/python'
        format = 'PYTHON'; sizeBytes = 250
      }
    ) -ExpectedProjectId 'example-project'
    $measurement.measuredBytes | Should -Be 350
    $measurement.repositoryCount | Should -Be 2
  }

  It 'rejects missing, malformed, duplicate, or wrong-project repository sizes' {
    $valid = [pscustomobject]@{
      name = 'projects/example-project/locations/us-central1/repositories/docker'
      format = 'DOCKER'; sizeBytes = '100'
    }
    foreach ($invalid in @(
        [pscustomobject]@{ name = $valid.name; format = 'DOCKER' },
        [pscustomobject]@{ name = $valid.name; format = 'DOCKER'; sizeBytes = '-1' },
        [pscustomobject]@{
          name = 'projects/another-project/locations/us-central1/repositories/docker'
          format = 'DOCKER'; sizeBytes = '100'
        }
      )) {
      { Measure-ArtifactRepositoryBytes -Repositories @($invalid) `
          -ExpectedProjectId 'example-project' } | Should -Throw
    }
    { Measure-ArtifactRepositoryBytes -Repositories @($valid,$valid) `
        -ExpectedProjectId 'example-project' } | Should -Throw '*duplicate*'
  }

  It 'uses billed repository size rather than ambiguous OCI manifest sizes at runtime' {
    $source = Get-Content (Join-Path $Root 'ops/gcp/audit-migration-capacity.ps1') -Raw
    $source | Should -Match "artifacts','repositories','list"
    $source | Should -Match 'Measure-ArtifactRepositoryBytes'
    $source | Should -Not -Match "artifacts','docker','images','list"
  }
}

Describe 'Cloud Storage operation-class accounting' {
  It 'parses the supported summarized du output for the exact bucket' {
    Convert-GcloudStorageDuBytes -Lines @(
      '22627451     gs://docai-templates-project-96fe5a5e-a0df-4a2f-902'
    ) -ExpectedBucket 'docai-templates-project-96fe5a5e-a0df-4a2f-902' |
      Should -Be 22627451
  }

  It 'rejects wrong-bucket, malformed, or multi-line du output' {
    { Convert-GcloudStorageDuBytes -Lines @('10 gs://other-bucket') -ExpectedBucket 'expected-bucket' } |
      Should -Throw '*identity*'
    { Convert-GcloudStorageDuBytes -Lines @('not-a-size gs://expected-bucket') -ExpectedBucket 'expected-bucket' } |
      Should -Throw '*format*'
    { Convert-GcloudStorageDuBytes -Lines @('1 gs://expected-bucket','2 gs://expected-bucket') -ExpectedBucket 'expected-bucket' } |
      Should -Throw '*one summary*'
  }

  It 'uses only supported gcloud storage du arguments in the live collector' {
    $source = Get-Content (Join-Path $Root 'ops/gcp/audit-migration-capacity.ps1') -Raw
    $source | Should -Match 'Convert-GcloudStorageDuBytes'
    $source | Should -Match "'storage','du','--summarize','--all-versions'"
    $source | Should -Not -Match 'storage du --summarize --recursive'
    $source | Should -Not -Match 'storage du[\s\S]{0,120}--format=json'
  }

  It 'separates observed Class A, Class B, and free operations' {
    $result = Measure-GcsOperationClasses -MethodCounts @{
      ListObjects = 20
      WriteObject = 3
      SetIamPolicy = 2
      ReadObject = 7
      GetObjectMetadata = 5
      DeleteObject = 11
    }

    $result.status | Should -Be 'passed'
    $result.classAOperations | Should -Be 25
    $result.classBOperations | Should -Be 12
    $result.freeOperations | Should -Be 11
    $result.safeCollectionError | Should -BeNullOrEmpty
  }

  It 'covers every method observed in the source project inventory' {
    $result = Measure-GcsOperationClasses -MethodCounts @{
      DeleteObject = 435
      GetBucketMetadata = 96
      GetBucketStorageLayout = 754
      GetIamPolicy = 140
      GetObjectMetadata = 941
      ListObjects = 20971
      MoveObject = 114
      ReadObject = 284
      SetIamPolicy = 6
      UpdateBucketMetadata = 1
      WriteObject = 623
    }

    $result.status | Should -Be 'passed'
    $result.classAOperations | Should -Be 21715
    $result.classBOperations | Should -Be 2215
    $result.freeOperations | Should -Be 435
  }

  It 'fails closed for an unknown positive-count method' {
    $result = Measure-GcsOperationClasses -MethodCounts @{
      ListObjects = 4
      FutureUnclassifiedOperation = 1
    }

    $result.status | Should -Be 'blocked'
    $result.safeCollectionError | Should -Be 'GCS_OPERATION_CLASSIFICATION_INCOMPLETE'
  }

  It 'rejects negative or non-finite method counts' {
    foreach ($value in @(-1, [double]::NaN, [double]::PositiveInfinity)) {
      { Measure-GcsOperationClasses -MethodCounts @{ ReadObject = $value } } |
        Should -Throw '*finite nonnegative*'
    }
  }

  It 'requires the live collector to classify method-labelled request counts once' {
    $source = Get-Content (Join-Path $Root 'ops/gcp/audit-migration-capacity.ps1') -Raw
    $source | Should -Match 'Get-MonitoringMethodSums'
    $source | Should -Match 'Measure-GcsOperationClasses'
    $source | Should -Not -Match "gcsClassAOperations\s*=\s*'storage\.googleapis\.com/api/request_count'"
    $source | Should -Not -Match "gcsClassBOperations\s*=\s*'storage\.googleapis\.com/api/request_count'"
  }
}

Describe 'Cloudflare Worker CPU accounting' {
  It 'converts GraphQL CPU quantiles from microseconds to milliseconds' {
    Convert-CloudflareCpuMicrosecondsToMilliseconds 7000 | Should -Be 7
    Convert-CloudflareCpuMicrosecondsToMilliseconds 212.5 | Should -Be 0.2125
  }

  It 'rejects negative and non-finite CPU quantiles' {
    foreach ($value in @(-1, [double]::NaN, [double]::PositiveInfinity)) {
      { Convert-CloudflareCpuMicrosecondsToMilliseconds $value } |
        Should -Throw '*finite nonnegative*'
    }
  }

  It 'requires the live collector to convert cpuTimeP95 before policy evaluation' {
    $source = Get-Content (Join-Path $Root 'ops/gcp/audit-migration-capacity.ps1') -Raw
    $source | Should -Match 'cpuTimeP95'
    $source | Should -Match 'Convert-CloudflareCpuMicrosecondsToMilliseconds'
  }
}

Describe 'Upstash monthly usage accounting' {
  It 'normalizes the documented database stats response fields' {
    $result = Convert-UpstashStatsObservation ([pscustomobject]@{
      current_storage = 1234
      total_monthly_requests = 5678
      total_monthly_bandwidth = 9012
    })

    $result.storageBytes | Should -Be 1234
    $result.commands | Should -Be 5678
    $result.bandwidthBytes | Should -Be 9012
  }

  It 'rejects missing, negative, or non-finite authoritative fields' {
    { Convert-UpstashStatsObservation ([pscustomobject]@{
        current_storage = 1
        total_monthly_requests = 2
      }) } | Should -Throw '*total_monthly_bandwidth*'

    foreach ($value in @(-1, [double]::NaN, [double]::PositiveInfinity)) {
      { Convert-UpstashStatsObservation ([pscustomobject]@{
          current_storage = $value
          total_monthly_requests = 2
          total_monthly_bandwidth = 3
        }) } | Should -Throw '*finite nonnegative*'
    }
  }

  It 'requires the live collector to use the normalized documented fields' {
    $source = Get-Content (Join-Path $Root 'ops/gcp/audit-migration-capacity.ps1') -Raw
    $source | Should -Match 'Convert-UpstashStatsObservation'
    $source | Should -Not -Match '\$stats\.database_size'
    $source | Should -Not -Match '\$stats\.commands'
    $source | Should -Not -Match '\$stats\.bandwidth'
  }
}

Describe 'Neon free-plan CU usage export contract' {
  BeforeAll {
    $SchemaPath = Join-Path $Root 'ops/schemas/neon-cu-usage-export.schema.json'
  }

  It 'accepts only the exact versioned nonnegative usage shape' {
    $valid = [ordered]@{
      schemaVersion = 1
      projectId = 'quiet-river-12345678'
      observedAt = '2026-08-15T09:00:00Z'
      cuHours = 12.5
    } | ConvertTo-Json
    Test-Json -Json $valid -SchemaFile $SchemaPath -ErrorAction Stop | Should -BeTrue

    $invalid = [ordered]@{
      schemaVersion = 1
      projectId = 'quiet-river-12345678'
      observedAt = '2026-08-15T09:00:00Z'
      cuHours = -1
      unreviewed = $true
    } | ConvertTo-Json
    Test-Json -Json $invalid -SchemaFile $SchemaPath -ErrorAction SilentlyContinue |
      Should -BeFalse
  }

  It 'requires the capacity collector to validate that schema before using the export' {
    $source = Get-Content (Join-Path $Root 'ops/gcp/audit-migration-capacity.ps1') -Raw
    $source | Should -Match "Test-Json[\s\S]+neon-cu-usage-export\.schema\.json"
  }
}

Describe 'Live collector bounded execution and billing scope' {
  BeforeAll {
    $script:auditPath = Join-Path $Root 'ops/gcp/audit-migration-capacity.ps1'
    $script:auditSource = Get-Content $auditPath -Raw
    $tokens = $null; $errors = $null
    $script:auditAst = [Management.Automation.Language.Parser]::ParseFile(
      $auditPath, [ref]$tokens, [ref]$errors)
    @($errors).Count | Should -Be 0
  }

  It 'gives every direct HTTP request an explicit timeout' {
    $httpCommands = @($auditAst.FindAll({
          param($node)
          $node -is [Management.Automation.Language.CommandAst] -and
          $node.GetCommandName() -in 'Invoke-RestMethod','Invoke-WebRequest'
        }, $true))
    $httpCommands.Count | Should -BeGreaterThan 0
    foreach ($command in $httpCommands) {
      @($command.CommandElements | ForEach-Object { $_.Extent.Text }) |
        Should -Contain '-TimeoutSec'
    }
  }

  It 'runs native provider commands through a killable bounded helper' {
    $boundedSource = Get-Content (Join-Path $Root 'ops/lib/BoundedProcess.psm1') -Raw
    $auditSource | Should -Match 'BoundedProcess\.psm1'
    $auditSource | Should -Match 'Invoke-BoundedNativeText'
    $boundedSource | Should -Match 'WaitForExit\('
    $boundedSource | Should -Match 'Kill\(\$true\)'
    $auditSource | Should -Not -Match '&\s+\$gcloud'
    $auditSource | Should -Not -Match '&\s+\$psql'
    $auditSource | Should -Not -Match '&\s+\(Get-Command gcloud\)'
  }

  It 'executes PowerShell wrapper files and returns only standard output' {
    $wrapper = Join-Path $TestDrive 'wrapper.ps1'
    Set-Content -LiteralPath $wrapper -Value "[Console]::Error.WriteLine('private-stderr'); 'safe-output'"
    $result = Invoke-BoundedNativeText -FilePath $wrapper -Arguments @() `
      -TimeoutSeconds 10 -SafeError 'wrapper failed'
    $result.Trim() | Should -Be 'safe-output'
    $result | Should -Not -Match 'private-stderr'
  }

  It 'kills a timed-out process and returns only a safe error' {
    $pwsh = (Get-Command pwsh -CommandType Application).Source
    { Invoke-BoundedNativeText -FilePath $pwsh `
        -Arguments @('-NoProfile','-Command','Start-Sleep -Seconds 5') `
        -TimeoutSeconds 1 -SafeError 'bounded command failed' } |
      Should -Throw 'bounded command failed: timeout'
  }

  It 'detects repeated or excessive provider pagination' {
    $auditSource | Should -Match 'PROVIDER_PAGINATION_LIMIT_EXCEEDED'
    $auditSource | Should -Match 'PROVIDER_PAGINATION_TOKEN_REPEATED'
  }

  It 'verifies the complete linked-project billing scope before account-wide collection' {
    $auditSource | Should -Match "billing','projects','list"
    $auditSource | Should -Match 'BILLING_SCOPE_AGGREGATION_REQUIRED'
  }
}
