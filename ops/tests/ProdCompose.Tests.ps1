# ProdCompose.Tests.ps1 — ticket 06 contract: VM production overlay.
#
# The overlay targets the Oracle Always Free ARM VM (Ubuntu, docker compose).
# These Pester checks lock its shape offline: caddy edge present, frontend
# absent (it lives on Cloudflare Pages — ticket 07), session/trust-proxy
# hardening set, no credentials baked in, merged compose config validates.

BeforeAll {
  $root = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path
  $overlay = Join-Path $root 'docker-compose.prod.yml'
  $caddyfile = Join-Path $root 'Caddyfile'
  $runbook = Join-Path $root 'docs/runbook.md'
}

Describe 'docker-compose.prod.yml overlay' {
  It 'exists' {
    Test-Path -LiteralPath $overlay | Should -BeTrue
  }

  It 'defines a caddy service on caddy:2-alpine' {
    $content = Get-Content -LiteralPath $overlay -Raw
    ($content | Select-String -Pattern 'image:\s*caddy:2-alpine' -Quiet) | Should -BeTrue
  }

  It 'publishes ports 80 and 443' {
    $content = Get-Content -LiteralPath $overlay -Raw
    ($content | Select-String -Pattern '"80:80"' -Quiet) | Should -BeTrue
    ($content | Select-String -Pattern '"443:443"' -Quiet) | Should -BeTrue
  }

  It 'mounts the Caddyfile and persistent caddy data volumes' {
    $content = Get-Content -LiteralPath $overlay -Raw
    ($content | Select-String -Pattern '\./Caddyfile:.*Caddyfile' -Quiet) | Should -BeTrue
    ($content | Select-String -Pattern 'caddy_data:.*\s*/data' -Quiet) | Should -BeTrue
  }

  It 'disables the frontend service (Cloudflare Pages owns it)' {
    $content = Get-Content -LiteralPath $overlay -Raw
    # The overlay must declare the frontend under a never-activated profile
    # so the VM composition never starts it.
    ($content | Select-String -Pattern '(?ms)^\s{2}frontend:.*profiles:\s*\["cloudflare-only"\]' -Quiet) | Should -BeTrue
  }

  It 'hardens the backend session/trust proxy behind TLS' {
    $content = Get-Content -LiteralPath $overlay -Raw
    ($content | Select-String -Pattern 'SESSION_COOKIE_SECURE:\s*"true"' -Quiet) | Should -BeTrue
    ($content | Select-String -Pattern 'TRUST_PROXY_HOPS:\s*"1"' -Quiet) | Should -BeTrue
    ($content | Select-String -Pattern 'CORS_ORIGIN:\s*\$\{CORS_ORIGIN' -Quiet) | Should -BeTrue
  }

  It 'contains no literal credentials (passwords/keys)' {
    $content = Get-Content -LiteralPath $overlay -Raw
    ($content | Select-String -Pattern 'PASSWORD\s*=|SECRET\s*=|API_KEY\s*=' -Quiet) | Should -BeFalse
  }
}

Describe 'Caddyfile' {
  It 'exists' {
    Test-Path -LiteralPath $caddyfile | Should -BeTrue
  }

  It 'reverse-proxies the api host to backend:3001' {
    $content = Get-Content -LiteralPath $caddyfile -Raw
    ($content | Select-String -Pattern 'reverse_proxy\s+backend:3001' -Quiet) | Should -BeTrue
  }

  It 'sets an explicit request body limit of at least 50MB' {
    $content = Get-Content -LiteralPath $caddyfile -Raw
    ($content | Select-String -Pattern 'request_body' -Quiet) | Should -BeTrue
    ($content | Select-String -Pattern 'max_size\s+(\d+)MB' -Quiet) | Should -BeTrue
    if ($content -match 'max_size\s+(\d+)MB') {
      [int]$Matches[1] | Should -BeGreaterOrEqual 50
    }
  }

  It 'contains no literal credentials' {
    $content = Get-Content -LiteralPath $caddyfile -Raw
    ($content | Select-String -Pattern 'PASSWORD\s*=|SECRET\s*=|API_KEY\s*=' -Quiet) | Should -BeFalse
  }

  It 'site label comes from API_DOMAIN (no empty-label global-options trap)' {
    $content = Get-Content -LiteralPath $caddyfile -Raw
    ($content | Select-String -Pattern '\{\$API_DOMAIN\}' -Quiet) | Should -BeTrue
  }
}

Describe 'merged compose config validates' {
  It 'docker compose -f base -f overlay config --quiet exits 0' {
    # The overlay REQUIRES prod env values (CORS_ORIGIN) — supply them
    # like the VM .env does, proving the guard passes when set.
    $env:CORS_ORIGIN = 'https://app.example.test'
    try {
      docker compose -f (Join-Path $root 'docker-compose.yml') -f $overlay config --quiet 2>$null
      $LASTEXITCODE | Should -Be 0
    } finally {
      Remove-Item Env:CORS_ORIGIN -ErrorAction SilentlyContinue
    }
  }

  It 'rejects a missing CORS_ORIGIN (guard is real)' {
    # Without the env var the overlay must refuse — the :? guard.
    $saved = $env:CORS_ORIGIN
    Remove-Item Env:CORS_ORIGIN -ErrorAction SilentlyContinue
    try {
      docker compose -f (Join-Path $root 'docker-compose.yml') -f $overlay config --quiet 2>$null
      $LASTEXITCODE | Should -Be 1
    } finally {
      if ($saved) { $env:CORS_ORIGIN = $saved }
    }
  }
}

Describe 'runbook deploy section' {
  It 'covers VM setup, deploy, rollback, first-boot order' {
    $content = Get-Content -LiteralPath $runbook -Raw
    $content | Should -Match '## 6\. Deploy'
    $content | Should -Match 'first-boot'
    $content | Should -Match 'rollback'
  }
}
