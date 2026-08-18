BeforeAll {
  $Root = Split-Path $PSScriptRoot -Parent | Split-Path -Parent
  Import-Module (Join-Path $Root 'ops/lib/Evidence.psm1') -Force
}

Describe 'Evidence primitives' {
  BeforeEach {
    $TestRoot = Join-Path $Root ".artifacts/releases/pester-evidence-$([guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Force $TestRoot | Out-Null
  }

  AfterEach {
    if (Test-Path -LiteralPath $TestRoot) {
      Remove-Item -LiteralPath $TestRoot -Recurse -Force
    }
  }

  It 'accepts only a descendant of .artifacts/releases' {
    $safe = Resolve-EvidencePath '.artifacts/releases/abc/00-preflight' $Root
    $safe | Should -Be (Join-Path $Root '.artifacts/releases/abc/00-preflight')
    { Resolve-EvidencePath '../outside' $Root } | Should -Throw '*outside .artifacts/releases*'
  }

  It 'rejects a reparse-point component before a write' {
    $outside = Join-Path ([IO.Path]::GetTempPath()) "docai-evidence-outside-$([guid]::NewGuid().ToString('N'))"
    $link = Join-Path $TestRoot 'linked'
    New-Item -ItemType Directory -Force $outside | Out-Null
    try {
      try {
        New-Item -ItemType Junction -Path $link -Target $outside -ErrorAction Stop | Out-Null
      } catch {
        Set-ItResult -Skipped -Because "This platform cannot create a disposable junction: $_"
        return
      }
      { Resolve-EvidencePath (Join-Path $link 'child.json') $Root } |
        Should -Throw '*reparse point*'
    } finally {
      if (Test-Path -LiteralPath $link) { Remove-Item -LiteralPath $link -Force }
      if (Test-Path -LiteralPath $outside) { Remove-Item -LiteralPath $outside -Recurse -Force }
    }
  }

  It 'writes canonical UTF-8 JSON and a matching checksum' {
    $first = Join-Path $TestRoot 'first.json'
    $second = Join-Path $TestRoot 'second.json'
    Write-EvidenceJson $first ([ordered]@{ status = 'passed'; schemaVersion = 1 })
    Write-EvidenceJson $second @{ schemaVersion = 1; status = 'passed' }

    [IO.File]::ReadAllBytes($first) | Should -Be ([IO.File]::ReadAllBytes($second))
    [IO.File]::ReadAllBytes($first)[0..2] | Should -Not -Be @(0xEF, 0xBB, 0xBF)
    (Get-Content $first -Raw | ConvertFrom-Json).status | Should -Be 'passed'
    (Get-EvidenceSha256 $first) | Should -Match '^[a-f0-9]{64}$'
  }

  It 'rejects credential-shaped textual evidence but ignores binary artifacts' {
    $binary = Join-Path $TestRoot 'legacy-data.dump'
    $bytes = [byte[]]::new(5MB)
    [Random]::Shared.NextBytes($bytes)
    [IO.File]::WriteAllBytes($binary, $bytes)
    { Assert-EvidenceContainsNoSecrets $TestRoot } | Should -Not -Throw

    Set-Content -LiteralPath (Join-Path $TestRoot 'bad.txt') `
      -Value 'postgresql://alice:secret@db.example/app'
    { Assert-EvidenceContainsNoSecrets $TestRoot } | Should -Throw '*secret-shaped*'
  }

  It 'accepts only a currently valid UTC observation window' {
    $now = [datetime]::SpecifyKind([datetime]'2026-08-15T00:00:00', 'Utc')
    (Test-EvidenceFresh $now.AddMinutes(-1) $now.AddMinutes(1) $now) | Should -BeTrue
    (Test-EvidenceFresh $now $now $now) | Should -BeFalse
    (Test-EvidenceFresh $now.ToLocalTime() $now.AddMinutes(1) $now) | Should -BeFalse
  }
}

Describe 'Evidence schemas' {
  It 'parses both schema documents as JSON' {
    foreach ($name in 'capacity-evidence.schema.json','preflight-decision.schema.json') {
      $path = Join-Path $Root "ops/schemas/$name"
      { Get-Content -LiteralPath $path -Raw | ConvertFrom-Json -ErrorAction Stop } |
        Should -Not -Throw
    }
  }
}
