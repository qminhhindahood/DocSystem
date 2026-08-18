BeforeAll {
  $Root = Split-Path $PSScriptRoot -Parent | Split-Path -Parent
  Import-Module (Join-Path $Root 'ops/lib/PreflightPolicy.psm1') -Force
  $Script = Join-Path $Root 'ops/gcp/inventory-storage.ps1'
}

Describe 'Storage inventory' {
  BeforeEach {
    $Evidence = Join-Path $Root ".artifacts/releases/$('c' * 40)/storage-$([guid]::NewGuid().ToString('N'))"
  }
  AfterEach { Remove-Item -LiteralPath $Evidence -Recurse -Force -ErrorAction SilentlyContinue }

  It 'rejects a bucket outside the exact project scope before discovery' {
    { & $Script -ProjectId 'project-96fe5a5e-a0df-4a2f-902' `
        -SourceRegion asia-southeast1 -TemplatesBucket 'unrelated' `
        -UploadsBucket 'docai-uploads-project-96fe5a5e-a0df-4a2f-902' `
        -RagStateBucket 'docai-rag-state-project-96fe5a5e-a0df-4a2f-902' `
        -ReleaseSha ('c' * 40) -EvidenceDirectory $Evidence } |
      Should -Throw '*not scoped*'
  }

  It 'normalizes generation, size, checksums, storage class, timestamp, and live state' {
    $row = Convert-GcsObjectRecord @{
      bucket = 'docai-uploads-project-96fe5a5e-a0df-4a2f-902'
      name = 'incoming/file.pdf'; generation = '1234567890123456'; size = '42'
      crc32c = 'ImIEBA=='; md5Hash = $null; storageClass = 'STANDARD'
      updated = '2026-08-15T00:00:00Z'
    }
    $row.bucket | Should -Be 'docai-uploads-project-96fe5a5e-a0df-4a2f-902'
    $row.generation | Should -Be '1234567890123456'
    $row.size | Should -Be 42
    $row.crc32c | Should -Be 'ImIEBA=='
    $row.live | Should -BeTrue
  }

  It 'rejects an object missing an authoritative CRC32C' {
    { Convert-GcsObjectRecord @{
        bucket = 'bucket'; name = 'file'; generation = '1'; size = 1
        storageClass = 'STANDARD'; updated = '2026-08-15T00:00:00Z'
      } } | Should -Throw '*CRC32C*'
  }

  It 'never treats an unknown migration rate as zero cost' {
    $estimate = Get-MigrationCostEstimate -LiveBytes 1024 -ArchiveBytes 0 `
      -ClassAOperations 1 -ClassBOperations 1 -Rates $null -SourceSnapshotSha256 $null
    $estimate.migrationCostUsd | Should -BeNullOrEmpty
    $estimate.requiresApproval | Should -BeTrue
    $estimate.ratesKnown | Should -BeFalse
  }

  It 'rounds a known nonzero estimate upward to the nearest cent' {
    $estimate = Get-MigrationCostEstimate -LiveBytes 1073741824 -ArchiveBytes 0 `
      -ClassAOperations 1 -ClassBOperations 1 -Rates @{
        transferPerGiB = 0.001; classAPer1000 = 0.001; classBPer1000 = 0.001; archivePerGiBMonth = 0
      } -SourceSnapshotSha256 ('d' * 64)
    $estimate.migrationCostUsd | Should -Be 0.01
    $estimate.requiresApproval | Should -BeTrue
  }
}
