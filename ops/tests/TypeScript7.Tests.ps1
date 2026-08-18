Describe 'strict TypeScript 7 toolchain' {
  BeforeAll {
    $root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
    $backend = Get-Content -LiteralPath (Join-Path $root 'backend/package.json') -Raw | ConvertFrom-Json
    $frontend = Get-Content -LiteralPath (Join-Path $root 'frontend/package.json') -Raw | ConvertFrom-Json
    $nextConfig = Get-Content -LiteralPath (Join-Path $root 'frontend/next.config.js') -Raw
    $eslintConfig = Get-Content -LiteralPath (Join-Path $root 'frontend/eslint.config.mjs') -Raw
  }

  It 'uses TypeScript 7 and API-independent backend development tooling' {
    $backend.devDependencies.typescript | Should -Match '^\^?7\.'
    $backend.scripts.dev | Should -Be 'tsx watch src/index.ts'
    ($backend.devDependencies.PSObject.Properties.Name -contains 'ts-node-dev') | Should -BeFalse
    ($backend.devDependencies.PSObject.Properties.Name -contains 'ts-jest') | Should -BeFalse
  }

  It 'runs the TypeScript 7 frontend check before Next build' {
    $frontend.devDependencies.typescript | Should -Match '^\^?7\.'
    $frontend.scripts.typecheck | Should -Be 'next typegen && tsc --noEmit'
    $frontend.scripts.build | Should -Be 'npm run typecheck && next build'
    $frontend.devDependencies.'@typescript/native-preview' | Should -Match '^7\.'
    $nextConfig | Should -Match 'ignoreBuildErrors:\s*true'
  }

  It 'does not load TypeScript compiler-API lint tooling' {
    ($frontend.devDependencies.PSObject.Properties.Name -contains 'eslint-config-next') | Should -BeFalse
    $eslintConfig | Should -Not -Match 'eslint-config-next|typescript-eslint'
    $eslintConfig | Should -Match '@babel/eslint-parser'
    $eslintConfig | Should -Match '@next/eslint-plugin-next'
  }

  It 'contains no TypeScript 6 compatibility dependency' {
    foreach ($path in @('backend/package.json', 'backend/package-lock.json', 'frontend/package.json', 'frontend/package-lock.json')) {
      $content = Get-Content -LiteralPath (Join-Path $root $path) -Raw
      $content | Should -Not -Match '@typescript/typescript6|typescript6@|typescript@npm:@typescript/typescript6'
    }
  }
}
