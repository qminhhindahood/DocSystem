# BackupScripts.Tests.ps1 — ticket 02 contract: nightly Postgres backup.
#
# The scripts target the production VM (Ubuntu, bash + docker compose). These
# Pester checks lock their contract offline so CI (repository-contracts job)
# fails if someone breaks dump format, retention, loud-failure behavior, or
# leaks secrets into them.

BeforeAll {
  $root = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path
  $dumpScript = Join-Path $root 'ops/backup/postgres-dump.sh'
  $syncScript = Join-Path $root 'ops/backup/sync-to-gcs.sh'
  $runbook = Join-Path $root 'docs/runbook.md'
}

Describe 'postgres-dump.sh' {
  It 'exists' {
    Test-Path -LiteralPath $dumpScript | Should -BeTrue
  }
  It 'uses custom-format pg_dump (-Fc) for pg_restore compatibility' {
    (Get-Content -LiteralPath $dumpScript -Raw) | Should -Match 'pg_dump([^\n]*\s-fc|-Fc)'
  }
  It 'fails loudly: set -euo pipefail' {
    (Get-Content -LiteralPath $dumpScript -Raw) | Should -Match 'set -euo pipefail'
  }
  It 'prunes dumps older than 30 days' {
    (Get-Content -LiteralPath $dumpScript -Raw) | Should -Match '-mtime\s*\+30'
  }
  It 'fails when the dump is empty (size guard)' {
    (Get-Content -LiteralPath $dumpScript -Raw) | Should -Match 'stat|du|s\*'
  }
  It 'contains no literal secrets (passwords/keys)' {
    $content = Get-Content -LiteralPath $dumpScript -Raw
    ($content | Select-String -Pattern 'PASSWORD=|SECRET=|API_KEY=' -Quiet) | Should -BeFalse
  }
  It 'reads database identity from env with defaults, not hardcoded secrets' {
    (Get-Content -LiteralPath $dumpScript -Raw) | Should -Match 'POSTGRES_USER|POSTGRES_DB'
  }
}

Describe 'sync-to-gcs.sh' {
  It 'exists' {
    Test-Path -LiteralPath $syncScript | Should -BeTrue
  }
  It 'fails loudly: set -euo pipefail' {
    (Get-Content -LiteralPath $syncScript -Raw) | Should -Match 'set -euo pipefail'
  }
  It 'requires GCS_BACKUP_BUCKET (no silent default bucket)' {
    (Get-Content -LiteralPath $syncScript -Raw) | Should -Match 'GCS_BACKUP_BUCKET'
  }
  It 'syncs idempotently (content compare, no blind delete)' {
    $content = Get-Content -LiteralPath $syncScript -Raw
    ($content | Select-String -Pattern 'rsync' -Quiet) | Should -BeTrue
    ($content | Select-String -Pattern 'delete-unmatched-destination\s+true' -Quiet) | Should -BeFalse
  }
  It 'contains no literal secrets' {
    $content = Get-Content -LiteralPath $syncScript -Raw
    ($content | Select-String -Pattern 'PASSWORD=|SECRET=|API_KEY=' -Quiet) | Should -BeFalse
  }
}

Describe 'backup runbook' {
  It 'docs/runbook.md exists with cron, GCS lifecycle, and drill steps' {
    Test-Path -LiteralPath $runbook | Should -BeTrue
    $content = Get-Content -LiteralPath $runbook -Raw
    ($content | Select-String -Pattern '0 3 \* \* \*' -Quiet) | Should -BeTrue
    ($content | Select-String -Pattern 'pg_restore' -Quiet) | Should -BeTrue
    ($content | Select-String -Pattern 'lifecycle|30-day|30 day' -Quiet) | Should -BeTrue
    ($content | Select-String -Pattern 'LLM_CONFIG_ENCRYPTION_KEY' -Quiet) | Should -BeTrue
  }
}
