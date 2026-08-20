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
