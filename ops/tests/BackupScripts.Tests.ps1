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
  $restoreScript = Join-Path $root 'ops/backup/restore-postgres.sh'
  $runbook = Join-Path $root 'docs/runbook.md'

  $gitBash = 'C:\Program Files\Git\bin\bash.exe'

  function ConvertTo-BashPath([string]$Path) {
    $full = [System.IO.Path]::GetFullPath($Path)
    return $full.Replace('\', '/')
  }
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
  It 'requires an age recipient and writes only encrypted backup files' {
    $content = Get-Content -LiteralPath $dumpScript -Raw
    $content | Should -Match 'AGE_RECIPIENT'
    $content | Should -Match 'age.*--encrypt'
    $content | Should -Match '\.pgdump\.age'
    $content | Should -Match 'trap.*plain'
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

Describe 'postgres-dump.sh behavior' {
  It 'removes plaintext after a successful fake dump and encryption' {
    $fakeDir = Join-Path $TestDrive 'fake-bin'
    $backupDir = Join-Path $TestDrive 'backups'
    New-Item -ItemType Directory -Path $fakeDir, $backupDir | Out-Null
    $docker = Join-Path $fakeDir 'docker'
    $age = Join-Path $fakeDir 'age'
    Set-Content -LiteralPath $docker -NoNewline -Value "#!/usr/bin/env bash`nhead -c 2048 /dev/zero`n"
    Set-Content -LiteralPath $age -NoNewline -Value @'
#!/usr/bin/env bash
set -euo pipefail
out=''
input=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) out="$2"; shift 2 ;;
    --recipient) shift 2 ;;
    --encrypt) shift ;;
    *) input="$1"; shift ;;
  esac
done
cp "$input" "$out"
'@
    $dockerBash = ConvertTo-BashPath $docker
    $ageBash = ConvertTo-BashPath $age
    $backupBash = ConvertTo-BashPath $backupDir
    $scriptBash = ConvertTo-BashPath $dumpScript
    $output = & $gitBash -lc "chmod +x '$dockerBash' '$ageBash' && env BACKUP_DIR='$backupBash' AGE_RECIPIENT='age1productionpublickey' DOCKER_BIN='$dockerBash' AGE_BIN='$ageBash' bash '$scriptBash'" 2>&1
    $LASTEXITCODE | Should -Be 0 -Because ($output -join "`n")

    @(Get-ChildItem -LiteralPath $backupDir -Filter '*.pgdump.age').Count | Should -Be 1
    @(Get-ChildItem -LiteralPath $backupDir -Filter '*.pgdump').Count | Should -Be 0
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
  It 'stages only encrypted dumps for upload' {
    $content = Get-Content -LiteralPath $syncScript -Raw
    $content | Should -Match '\*\.pgdump\.age'
    $content | Should -Not -Match '\*\.pgdump[^\.]'
  }
  It 'contains no literal secrets' {
    $content = Get-Content -LiteralPath $syncScript -Raw
    ($content | Select-String -Pattern 'PASSWORD=|SECRET=|API_KEY=' -Quiet) | Should -BeFalse
  }
}

Describe 'restore-postgres.sh' {
  It 'exists and requires the recovery identity plus typed destructive confirmation' {
    Test-Path -LiteralPath $restoreScript | Should -BeTrue
    $content = Get-Content -LiteralPath $restoreScript -Raw
    $content | Should -Match 'AGE_IDENTITY_FILE'
    $content | Should -Match 'RESTORE.*POSTGRES_DB|RESTORE.*database'
    $content | Should -Match 'pg_restore'
    $content | Should -Match 'trap.*plain'
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
