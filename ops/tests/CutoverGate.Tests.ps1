# CutoverGate.Tests.ps1 — ticket 08 contract: cutover gate + monitoring docs.
#
# The cutover gate is a hard user requirement: preflight PASS, checklist
# walked on production, human-verified conversion. These checks lock the
# artifacts offline: the checklist covers every gate item with dated
# sign-off boxes, the runbook carries the exact monitoring setup commands,
# and the preflight script exists and runs as the checklist demands.

BeforeAll {
  $root = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path
  $checklist = Join-Path $root 'conversion-service' 'CUTOVER_CHECKLIST.md'
  $preflight = Join-Path $root 'conversion-service' 'eval' 'preflight.py'
  $runbook = Join-Path $root 'docs' 'runbook.md'
}

Describe 'cutover checklist' {
  It 'exists' {
    Test-Path -LiteralPath $checklist | Should -BeTrue
  }

  It 'gates on preflight PASS first' {
    $content = Get-Content -LiteralPath $checklist -Raw
    $content | Should -Match 'PREFLIGHT: PASS'
  }

  It 'has dated execution and human sign-off boxes' {
    $content = Get-Content -LiteralPath $checklist -Raw
    $content | Should -Match 'Execution date'
    $content | Should -Match 'Sign-off:'
  }

  It 'covers the smoke-test battery' {
    $content = Get-Content -LiteralPath $checklist -Raw
    foreach ($item in @('422', '400', 'Bulk upload', '429', 'fidelityLedger')) {
      $content | Should -Match ([regex]::Escape($item))
    }
  }

  It 'covers prod overlay + Cloudflare path' {
    $content = Get-Content -LiteralPath $checklist -Raw
    $content | Should -Match 'docker-compose\.prod\.yml'
    $content | Should -Match 'app\.<domain>'
    $content | Should -Match '2 OCPU / 12 GB'
    $content | Should -Match 'origin/main'
    $content | Should -Not -Match '4 OCPU / 24 GB|Cloudflare Pages'
  }

  It 'covers encrypted backup and account-operation exercises' {
    $content = Get-Content -LiteralPath $checklist -Raw
    $content | Should -Match 'postgres-dump\.sh'
    $content | Should -Match '\.pgdump\.age'
    $content | Should -Match 'reset_operator_password'
    $content | Should -Match 'manage_users'
    $content | Should -Match 'self-service.*delet|delet.*self-service'
  }

  It 'gates public registration and soft launch operations' {
    $content = Get-Content -LiteralPath $checklist -Raw
    $content | Should -Match 'Turnstile'
    $content | Should -Match 'support@<domain>'
    $content | Should -Match 'five-second|5-second'
    $content | Should -Match '48-hour'
    $content | Should -Match 'test email'
    $content | Should -Not -Match 'UptimeRobot|Grafana|Telegram'
  }

  It 'records known limitations honestly' {
    $content = Get-Content -LiteralPath $checklist -Raw
    $content | Should -Match 'fixture-certified'
  }
}

Describe 'preflight script' {
  It 'exists at the prescribed path' {
    Test-Path -LiteralPath $preflight | Should -BeTrue
  }

  It 'prints the PASS verdict the checklist gates on' {
    $content = Get-Content -LiteralPath $preflight -Raw
    $content | Should -Match 'PREFLIGHT: PASS'
  }
}

Describe 'monitoring runbook' {
  It 'carries the provider-native GCP and OCI setup commands' {
    $content = Get-Content -LiteralPath $runbook -Raw
    $content | Should -Match 'gcloud monitoring uptime create'
    $content | Should -Match 'oci monitoring alarm create'
    $content | Should -Match 'publish-oci-metrics\.sh'
    $content | Should -Not -Match 'UptimeRobot|Grafana Cloud|Telegram'
  }

  It 'documents all four metric alarm thresholds' {
    $content = Get-Content -LiteralPath $runbook -Raw
    $content | Should -Match 'queue_depth.*80.*10'
    $content | Should -Match 'disk_used_percent.*80.*15'
    $content | Should -Match 'backup_age_seconds.*129600'
    $content | Should -Match 'unhealthy_container_count.*1.*5'
  }

  It 'requires an email subscription confirmation and test alert' {
    $content = Get-Content -LiteralPath $runbook -Raw
    $content | Should -Match 'subscription.*confirm|confirm.*subscription'
    $content | Should -Match 'test email'
  }

  It 'keeps a manual-check fallback' {
    $content = Get-Content -LiteralPath $runbook -Raw
    $content | Should -Match '8\.4'
    $content | Should -Match 'collect-health\.sh'
  }
}
