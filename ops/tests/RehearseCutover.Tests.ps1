BeforeAll {
  Import-Module "$PSScriptRoot\..\lib\PostgresTools.psm1" -Force
}

Describe 'rehearse-cutover.ps1 safety contract' {
  BeforeAll {
    $scriptPath = "$PSScriptRoot\..\rehearse-cutover.ps1"
    $source = Get-Content -LiteralPath $scriptPath -Raw
  }

  It 'exists and uses only disposable prefixed resources' {
    (Test-Path -LiteralPath $scriptPath) | Should -BeTrue
    $source | Should -Match 'docai_rehearsal_'
    $source | Should -Match 'Assert-RehearsalName'
  }
  It 'does not consume a live DATABASE_URL' {
    $source | Should -Not -Match '\$sourceUrl\s*=\s*\$env:DATABASE_URL'
    $source | Should -Not -Match '\$targetUrl\s*=\s*\$env:DATABASE_URL'
    $source | Should -Match '\$env:DATABASE_URL\s*=\s*\$targetUrl'
    $source | Should -Match 'fixtures/legacy-schema.sql'
    $source | Should -Match 'fixtures/legacy-data.sql'
  }
  It 'uses distinct source and target containers and volumes' {
    $source | Should -Match '_source'
    $source | Should -Match '_target'
    $source | Should -Match '_source_vol'
    $source | Should -Match '_target_vol'
  }
  It 'runs backup, migration, data-only import, and verification' {
    $source | Should -Match 'backup-postgres.ps1'
    $source | Should -Match 'deploy_fresh_database.ts'
    $source | Should -Match "prisma','migrate','deploy"
    $source | Should -Match 'import-postgres-data.ps1'
    $source | Should -Match 'verify-postgres.ps1'
  }
  It 'publishes PostgreSQL on a valid random loopback port' {
    $migrationRehearsal = Get-Content -LiteralPath "$PSScriptRoot\..\test-migrations.ps1" -Raw
    $migrationRehearsal | Should -Match "'--publish', '127\.0\.0\.1::5432'"
    $migrationRehearsal | Should -Not -Match '\$hostPort\s*=\s*0'
    $migrationRehearsal | Should -Match '\$env:DATABASE_URL\s*=\s*\$DatabaseUrl'
    $migrationRehearsal | Should -Not -Match '-Environment'
  }
  It 'has committed fixture files' {
    (Test-Path -LiteralPath "$PSScriptRoot\..\fixtures\legacy-schema.sql") | Should -BeTrue
    (Test-Path -LiteralPath "$PSScriptRoot\..\fixtures\legacy-data.sql") | Should -BeTrue
  }
}

Describe 'rehearsal integration' {
  It 'passes against Docker when explicitly requested' -Pending {
    { & "$PSScriptRoot\..\rehearse-cutover.ps1" } | Should -Not -Throw
  }
}
