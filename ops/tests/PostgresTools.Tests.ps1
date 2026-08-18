# PostgresTools.Tests.ps1 — Pester 5-compatible tests for PostgresTools.psm1

BeforeAll {
  Import-Module "$PSScriptRoot\..\lib\PostgresTools.psm1" -Force
}

Describe 'Invoke-NativeChecked' {
  It 'throws when a native command exits non-zero' {
    $msg = $null
    try { Invoke-NativeChecked pwsh '-NoProfile', '-Command', 'exit 1' } catch { $msg = "$_" }
    $msg | Should -Not -BeNullOrEmpty
  }
  It 'passes through when exit code is zero' {
    { Invoke-NativeChecked pwsh '-NoProfile', '-Command', 'exit 0' } | Should -Not -Throw
  }
  It 'captures the failing exit code in the error message' {
    try { Invoke-NativeChecked pwsh '-NoProfile', '-Command', 'exit 42'; $msg = '' }
    catch { $msg = "$_" }
    $msg | Should -Match 'exit code 42'
  }
}

Describe 'Get-DatabaseIdentity' {
  It 'returns a comparable object from a postgresql:// URL' {
    $id = Get-DatabaseIdentity ([uri]'postgresql://user:pass@myhost:5433/mydb')
    $id.Host | Should -Be 'myhost'
    $id.Port | Should -Be 5433
    $id.Database | Should -Be 'mydb'
  }
  It 'defaults port to 5432 when omitted' {
    $id = Get-DatabaseIdentity ([uri]'postgresql://user@pg.example.com/mydb')
    $id.Port | Should -Be 5432
  }
  It 'normalises host to lowercase' {
    $id = Get-DatabaseIdentity ([uri]'postgresql://user@PG.EXAMPLE.COM/db')
    $id.Host | Should -Be 'pg.example.com'
  }
  It 'normalises database name to lowercase' {
    $id = Get-DatabaseIdentity ([uri]'postgresql://user@host/MyDB')
    $id.Database | Should -Be 'mydb'
  }
  It 'treats identical servers as equal' {
    $a = Get-DatabaseIdentity ([uri]'postgresql://u:p@host:5432/db')
    $b = Get-DatabaseIdentity ([uri]'postgresql://u:different@host:5432/db')
    $a.Host | Should -Be $b.Host
    $a.Port | Should -Be $b.Port
    $a.Database | Should -Be $b.Database
  }
}

Describe 'Assert-RehearsalName' {
  It 'passes when name starts with docai_rehearsal_' {
    { Assert-RehearsalName 'docai_rehearsal_my_container' } | Should -Not -Throw
  }
  It 'throws when name does not start with the prefix' {
    $msg = $null
    try { Assert-RehearsalName 'production_container' } catch { $msg = "$_" }
    $msg | Should -Not -BeNullOrEmpty
  }
  It 'rejects empty or whitespace-only names' {
    $msg = $null
    try { Assert-RehearsalName '' } catch { $msg = "$_" }
    $msg | Should -Not -BeNullOrEmpty
    $msg = $null
    try { Assert-RehearsalName '   ' } catch { $msg = "$_" }
    $msg | Should -Not -BeNullOrEmpty
  }
}

Describe 'Get-Sha256Hash' {
  It 'returns a 64-char hex string' {
    $tmp = [System.IO.Path]::GetTempFileName()
    try {
      Set-Content -LiteralPath $tmp -Value 'hello world' -NoNewline
      $hash = Get-Sha256Hash $tmp
      $hash.Length | Should -Be 64
      $hash | Should -Match '^[a-f0-9]{64}$'
    } finally { Remove-Item -LiteralPath $tmp -Force }
  }
}

Describe 'Integration: Get-PrimaryKeyHashes and Get-RowCounts' {
  It 'require a live PostgreSQL database — skipped by default' -Pending {
    { Get-PrimaryKeyHashes 'postgresql://postgres:test@localhost:5432/test' } | Should -Not -Throw
  }
}
