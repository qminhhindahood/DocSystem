# CloudflarePages.Tests.ps1 — ticket 07 contract: Cloudflare frontend deployment.
#
# The frontend deploys as a Cloudflare Worker via @opennextjs/cloudflare
# (hybrid platform: Cloudflare for the frontend, Oracle VM for the stateful
# stack — ADR-0002). These checks lock the adapter config offline: the
# runtime env read contract (Workers get env vars at request time, so
# BACKEND_API_URL must never be captured at module load), wrangler shape,
# and the build script wiring.

BeforeAll {
  $root = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path
  $frontend = Join-Path $root 'frontend'
  $wrangler = Join-Path $frontend 'wrangler.jsonc'
  $openNext = Join-Path $frontend 'open-next.config.ts'
  $backendHelper = Join-Path $frontend 'lib' 'server' 'backend.ts'
  $proxyRoute = Join-Path $frontend 'app' 'api' 'proxy' '[...path]' 'route.ts'
  $pkgJson = Join-Path $frontend 'package.json'
}

Describe 'OpenNext adapter config' {
  It 'wrangler.jsonc exists with nodejs_compat' {
    Test-Path -LiteralPath $wrangler | Should -BeTrue
    $content = Get-Content -LiteralPath $wrangler -Raw
    ($content | Select-String -Pattern 'nodejs_compat' -Quiet) | Should -BeTrue
    ($content | Select-String -Pattern 'global_fetch_strictly_public' -Quiet) | Should -BeTrue
  }

  It 'open-next.config.ts exists using defineCloudflareConfig' {
    Test-Path -LiteralPath $openNext | Should -BeTrue
    $content = Get-Content -LiteralPath $openNext -Raw
    ($content | Select-String -Pattern 'defineCloudflareConfig' -Quiet) | Should -BeTrue
  }

  It 'BACKEND_API_URL is runtime, never baked in wrangler.jsonc' {
    $content = Get-Content -LiteralPath $wrangler -Raw
    # 'vars' would bake the value at deploy; the ticket requires runtime.
    ($content | Select-String -Pattern '"vars"' -Quiet) | Should -BeFalse
  }

  It 'worker build script exists in package.json' {
    $content = Get-Content -LiteralPath $pkgJson -Raw
    ($content | Select-String -Pattern '"build:worker"' -Quiet) | Should -BeTrue
  }
}

Describe 'runtime env read contract (Workers)' {
  It 'backend.ts never captures env at module load' {
    $content = Get-Content -LiteralPath $backendHelper -Raw
    ($content | Select-String -Pattern '(?m)^\s*const\s+\w+\s*=\s*process\.env\.' -Quiet) | Should -BeFalse
  }

  It 'proxy route never captures env at module load' {
    $content = Get-Content -LiteralPath $proxyRoute -Raw
    ($content | Select-String -Pattern '(?m)^\s*const\s+\w+\s*=\s*process\.env\.' -Quiet) | Should -BeFalse
  }

  It 'gitignore covers OpenNext build artifacts' {
    $content = Get-Content -LiteralPath (Join-Path $frontend '.gitignore') -Raw
    ($content | Select-String -Pattern '\.open-next' -Quiet) | Should -BeTrue
    ($content | Select-String -Pattern '\.wrangler' -Quiet) | Should -BeTrue
  }
}
