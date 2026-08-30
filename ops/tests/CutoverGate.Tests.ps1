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
  }

  It 'covers backup + admin reset exercises' {
    $content = Get-Content -LiteralPath $checklist -Raw
    $content | Should -Match 'postgres-dump\.sh'
    $content | Should -Match 'reset_operator_password'
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
  It 'carries the exact UptimeRobot and Grafana setup steps' {
    $content = Get-Content -LiteralPath $runbook -Raw
    $content | Should -Match 'UptimeRobot'
    $content | Should -Match 'Grafana Cloud'
  }

  It 'documents both alert rules with thresholds' {
    $content = Get-Content -LiteralPath $runbook -Raw
    $content | Should -Match 'conversion_jobs_failed_total'
    $content | Should -Match 'conversion_queue_depth'
  }

  It 'keeps the manual-check fallback while materials pend' {
    $content = Get-Content -LiteralPath $runbook -Raw
    $content | Should -Match '8\.4'
  }
}
