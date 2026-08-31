BeforeAll {
  $root = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path
  $wizard = Join-Path $root 'ops/cutover-wizard.sh'
  $template = 'C:\Users\PC\.agents\skills\wizard\template.sh'
  $marker = '# ──────────────────────────────────────────────────────────────────────────' + "`n# STAGES"
}

Describe 'production cutover wizard' {
  It 'preserves the canonical wizard library byte-for-byte' {
    $expected = (Get-Content -LiteralPath $template -Raw).Replace("`r`n", "`n")
    $actual = (Get-Content -LiteralPath $wizard -Raw).Replace("`r`n", "`n")
    $expectedIndex = $expected.IndexOf($marker)
    $actualIndex = $actual.IndexOf($marker)
    $expectedIndex | Should -BeGreaterThan 0
    $actualIndex | Should -BeGreaterThan 0
    $actual.Substring(0, $actualIndex) | Should -BeExactly $expected.Substring(0, $expectedIndex)
  }

  It 'has the nine agreed stages' {
    $content = Get-Content -LiteralPath $wizard -Raw
    $content | Should -Match 'TOTAL_STAGES=9'
    ($content | Select-String -Pattern '(?m)^stage "' -AllMatches).Matches.Count | Should -Be 9
    foreach ($stageName in @(
      'Preflight and main commit',
      'Free-tier accounts',
      'Domain, policy, and secrets',
      'Oracle Always Free VM',
      'Cloudflare Worker',
      'Encrypted GCS backup',
      'Monitoring and email alerts',
      'Deploy exact main commit',
      'Soft-launch gate'
    )) {
      $content | Should -Match ([regex]::Escape("stage `"$stageName`""))
    }
  }

  It 'locks the free-only capacity decision and stops on capacity failure' {
    $content = Get-Content -LiteralPath $wizard -Raw
    $content | Should -Match 'VM\.Standard\.A1\.Flex'
    $content | Should -Match '2 OCPU / 12 GB'
    $content | Should -Match 'out of host capacity'
    $content | Should -Match 'stop.*cutover|cutover.*stop'
    $content | Should -Not -Match '4 OCPU / 24 GB'
    $content | Should -Not -Match 'e2-micro.*deploy|deploy.*e2-micro'
  }

  It 'deploys only main and uses the correct public origins' {
    $content = Get-Content -LiteralPath $wizard -Raw
    $content | Should -Match 'origin/main'
    $content | Should -Not -Match 'codex/complete-remediation'
    $content | Should -Match 'BACKEND_API_URL="https://\$API_DOMAIN"'
    $content | Should -Match 'APP_ORIGIN="https://app\.\$DOMAIN"'
    $content | Should -Match 'API_DOMAIN=''\$API_DOMAIN'' APP_ORIGIN=''\$APP_ORIGIN'' ./ops/deploy-production\.sh'
    $content | Should -Match 'PUBLIC_SUPPORT_EMAIL'
    $content | Should -Match '2026-08-31'
  }

  It 'uses the real preflight path and an empty clone target' {
    $content = Get-Content -LiteralPath $wizard -Raw
    $content | Should -Match 'conversion-service/eval/preflight\.py'
    $content | Should -Match 'DEPLOY_DIR'
    $content | Should -Match 'must be empty|empty directory'
  }

  It 'does not persist production secret values in wizard state' {
    $content = Get-Content -LiteralPath $wizard -Raw
    foreach ($secret in @('JWT_SECRET', 'LLM_CONFIG_ENCRYPTION_KEY', 'TURNSTILE_SECRET_KEY', 'AGE_IDENTITY')) {
      $content | Should -Not -Match "write_env\s+$secret"
    }
    $content | Should -Not -Match 'DB_PASSWORD=\$|JWT_SECRET=\$|LLM_CONFIG_ENCRYPTION_KEY=\$'
  }

  It 'uses provider-native monitoring and the encrypted backup artifact' {
    $content = Get-Content -LiteralPath $wizard -Raw
    $content | Should -Match 'GCP uptime'
    $content | Should -Match 'OCI custom metrics'
    $content | Should -Match '\.pgdump\.age'
    $content | Should -Not -Match 'UptimeRobot|Grafana|Telegram'
  }
}
