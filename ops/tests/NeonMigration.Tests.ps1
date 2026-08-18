BeforeAll {
  $Root = Split-Path $PSScriptRoot -Parent | Split-Path -Parent
  $BackupScript = Join-Path $Root 'ops/backup-postgres.ps1'
  $ImportScript = Join-Path $Root 'ops/import-postgres-data.ps1'
  $RestoreScript = Join-Path $Root 'ops/gcp/restore-to-neon.ps1'
  $VerifyScript = Join-Path $Root 'ops/gcp/verify-neon-restore.ps1'
  $ShutdownScript = Join-Path $Root 'ops/gcp/export-and-shutdown.ps1'
}

Describe 'Neon recovery preview safety' {
  BeforeEach {
    $FixtureRoot = Join-Path $Root ".artifacts/releases/$('b' * 40)/pester-neon-$([guid]::NewGuid().ToString('N'))"
    $DumpDirectory = Join-Path $FixtureRoot 'dump'
    $Evidence = Join-Path $FixtureRoot 'evidence'
    New-Item -ItemType Directory -Force $DumpDirectory, $Evidence | Out-Null
    $Quiescence = Join-Path $FixtureRoot 'quiescence.json'
    @{ writesStopped = $true; sourceHost = 'source.example'; sourcePort = 5432; sourceDatabase = 'app' } |
      ConvertTo-Json | Set-Content -LiteralPath $Quiescence
    Set-Content -LiteralPath (Join-Path $DumpDirectory 'legacy-data.dump') -Value 'fixture' -NoNewline
    $dumpHash = (Get-FileHash (Join-Path $DumpDirectory 'legacy-data.dump') -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath (Join-Path $DumpDirectory 'legacy-data.dump.sha256') -Value $dumpHash
    @{
      version = 2
      sourceIdentity = @{ host = 'source.example'; port = 5432; database = 'app' }
      dump = @{ file = 'legacy-data.dump'; sha256 = $dumpHash; format = 'postgres-custom-data-only' }
      quiescenceEvidenceSha256 = (Get-FileHash $Quiescence -Algorithm SHA256).Hash.ToLowerInvariant()
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $DumpDirectory 'manifest.json')
    $env:DOC_AI_SOURCE_DATABASE_URL = 'postgresql://source:secret@source.example:5432/app?sslmode=require'
    $env:DOC_AI_NEON_DIRECT_URL = 'postgresql://target:secret@target.us-east-2.aws.neon.tech:5432/app?sslmode=require'
    $env:DOC_AI_AGE_RECIPIENT = 'age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqp7gy0'
  }

  AfterEach {
    Remove-Item -LiteralPath $FixtureRoot -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item Env:DOC_AI_SOURCE_DATABASE_URL, Env:DOC_AI_NEON_DIRECT_URL, Env:DOC_AI_AGE_RECIPIENT `
      -ErrorAction SilentlyContinue
  }

  It 'does not create a dump without -Execute' {
    Remove-Item -LiteralPath (Join-Path $DumpDirectory 'legacy-data.dump') -Force
    & $BackupScript -OutputDir $DumpDirectory -QuiescenceEvidencePath $Quiescence
    Test-Path -LiteralPath (Join-Path $DumpDirectory 'legacy-data.dump') | Should -BeFalse
  }

  It 'does not invoke a restore without -Execute' {
    & $RestoreScript -DumpDirectory $DumpDirectory -QuiescenceEvidencePath $Quiescence `
      -ReleaseSha ('b' * 40) -EvidenceDirectory $Evidence
    Test-Path -LiteralPath (Join-Path $Evidence 'restore-evidence.json') | Should -BeTrue
    (Get-Content (Join-Path $Evidence 'restore-evidence.json') -Raw | ConvertFrom-Json).status |
      Should -Be 'preview'
  }

  It 'keeps direct import in preview without -Execute' {
    & $ImportScript -DumpDir $DumpDirectory -QuiescenceEvidencePath $Quiescence
    $LASTEXITCODE | Should -BeIn 0, $null
  }

  It 'rejects identical source and target identities before native commands' {
    $env:DOC_AI_NEON_DIRECT_URL = $env:DOC_AI_SOURCE_DATABASE_URL
    { & $RestoreScript -DumpDirectory $DumpDirectory -QuiescenceEvidencePath $Quiescence `
        -ReleaseSha ('b' * 40) -EvidenceDirectory $Evidence -Execute } |
      Should -Throw '*same database*'
  }
}

Describe 'Neon recovery command surfaces' {
  It 'never accepts a database URL parameter' {
    foreach ($script in $BackupScript, $ImportScript, $RestoreScript, $VerifyScript) {
      $parameters = (Get-Command $script).Parameters.Keys
      @($parameters | Where-Object { $_ -match 'DatabaseUrl' }).Count | Should -Be 0
    }
  }

  It 'requires accepted restore evidence before shutdown discovery or deletion' {
    $shutdownArgs = @{
      ProjectId = 'project-96fe5a5e-a0df-4a2f-902'; Region = 'asia-southeast1'
      InstanceName = 'docai-postgres'; DatabaseName = 'docai'
      ExportBucket = 'docai-exports-project-96fe5a5e-a0df-4a2f-902'
      TemplatesBucket = 'docai-templates-project-96fe5a5e-a0df-4a2f-902'
      UploadsBucket = 'docai-uploads-project-96fe5a5e-a0df-4a2f-902'
      RagStateBucket = 'docai-rag-state-project-96fe5a5e-a0df-4a2f-902'
      LlmEncryptionKeySecret = 'docai-llm-config-encryption-key'; ConfirmShutdown = $true
      AcceptedRestoreEvidencePath = (Join-Path $TestDrive 'missing-restore.json')
      AcceptedRestoreEvidenceSha256 = ('a' * 64)
    }
    { & $ShutdownScript @shutdownArgs } | Should -Throw '*accepted Neon restore evidence*'
  }

  It 'parses every recovery script without errors' {
    foreach ($script in $BackupScript, $ImportScript, $RestoreScript, $VerifyScript, $ShutdownScript) {
      $tokens = $null; $errors = $null
      [Management.Automation.Language.Parser]::ParseFile($script, [ref]$tokens, [ref]$errors) | Out-Null
      @($errors).Count | Should -Be 0
    }
  }
}
