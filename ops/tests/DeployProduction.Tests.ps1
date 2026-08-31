BeforeAll {
  $root = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path
  $deploy = Join-Path $root 'ops/deploy-production.sh'
  $gitBash = 'C:\Program Files\Git\bin\bash.exe'

  function ConvertTo-BashPath([string]$Path) {
    return ([System.IO.Path]::GetFullPath($Path)).Replace('\', '/')
  }

  function New-FakeCommands([string]$Directory) {
    New-Item -ItemType Directory -Path $Directory -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $Directory 'git') -NoNewline -Value @'
#!/usr/bin/env bash
echo "git $*" >> "$CALL_LOG"
case "$1 $2" in
  "branch --show-current") echo main ;;
  "status --porcelain") [[ "${FAKE_GIT_DIRTY:-0}" == 1 ]] && echo dirty ;;
  "rev-parse HEAD") echo 1111111111111111111111111111111111111111 ;;
  "rev-parse origin/main^{commit}") echo 2222222222222222222222222222222222222222 ;;
  "merge-base --is-ancestor") [[ "${FAKE_NOT_ANCESTOR:-0}" == 1 ]] && exit 1 || exit 0 ;;
  *) exit 0 ;;
esac
'@
    Set-Content -LiteralPath (Join-Path $Directory 'docker') -NoNewline -Value @'
#!/usr/bin/env bash
echo "docker $*" >> "$CALL_LOG"
if [[ "$1 $2" == "image inspect" ]]; then
  case "$3" in
    standalone/backend:latest) echo sha256:backend-old ;;
    standalone/conversion:latest) echo sha256:conversion-old ;;
    caddy:2-alpine) echo sha256:caddy-old ;;
    *) exit 1 ;;
  esac
fi
'@
    Set-Content -LiteralPath (Join-Path $Directory 'curl') -NoNewline -Value @'
#!/usr/bin/env bash
echo "curl $*" >> "$CALL_LOG"
[[ "${FAKE_HEALTH:-healthy}" == healthy ]]
'@
    Set-Content -LiteralPath (Join-Path $Directory 'sleep') -NoNewline -Value @'
#!/usr/bin/env bash
exit 0
'@
  }

  function Invoke-FakeDeploy(
    [string]$TestDirectory,
    [hashtable]$Environment = @{},
    [string]$Sha = '2222222222222222222222222222222222222222'
  ) {
    $fakeDir = Join-Path $TestDirectory 'bin'
    New-FakeCommands $fakeDir
    $callLog = Join-Path $TestDirectory 'calls.log'
    New-Item -ItemType File -Path $callLog -Force | Out-Null
    $fakeBash = ConvertTo-BashPath $fakeDir
    $deployBash = ConvertTo-BashPath $deploy
    $callLogBash = ConvertTo-BashPath $callLog
    $pairs = @(
      "CALL_LOG='$callLogBash'",
      "GIT_BIN='$fakeBash/git'",
      "DOCKER_BIN='$fakeBash/docker'",
      "CURL_BIN='$fakeBash/curl'",
      "API_DOMAIN='api.example.test'",
      "APP_ORIGIN='https://app.example.test'",
      "HEALTH_TIMEOUT_SECONDS=30",
      "HEALTH_INTERVAL_SECONDS=0",
      "HEALTH_MAX_ROUNDS=3",
      "SLEEP_BIN='$fakeBash/sleep'"
    )
    foreach ($entry in $Environment.GetEnumerator()) {
      $pairs += "$($entry.Key)='$($entry.Value)'"
    }
    $output = & $gitBash -lc "chmod +x '$fakeBash'/* && env $($pairs -join ' ') bash '$deployBash' '$Sha'" 2>&1
    return [pscustomobject]@{
      ExitCode = $LASTEXITCODE
      Output = $output -join "`n"
      Calls = Get-Content -LiteralPath $callLog -Raw
    }
  }
}

Describe 'production deploy helper' {
  It 'exists and rejects a non-commit argument' {
    Test-Path -LiteralPath $deploy | Should -BeTrue
    $result = Invoke-FakeDeploy (Join-Path $TestDrive 'invalid') -Sha 'main'
    $result.ExitCode | Should -Not -Be 0
    $result.Output | Should -Match '40-character'
  }

  It 'rejects a dirty production checkout before building' {
    $result = Invoke-FakeDeploy (Join-Path $TestDrive 'dirty') @{ FAKE_GIT_DIRTY = '1' }
    $result.ExitCode | Should -Not -Be 0
    $result.Output | Should -Match 'dirty'
    $result.Calls | Should -Not -Match 'docker compose.*build'
  }

  It 'rejects a commit that is not the current origin/main commit' {
    $result = Invoke-FakeDeploy (Join-Path $TestDrive 'wrong-sha') -Sha '3333333333333333333333333333333333333333'
    $result.ExitCode | Should -Not -Be 0
    $result.Output | Should -Match 'origin/main'
    $result.Calls | Should -Not -Match 'docker compose.*build'
  }

  It 'deploys a healthy exact main revision after three successful health rounds' {
    $result = Invoke-FakeDeploy (Join-Path $TestDrive 'healthy')
    $result.ExitCode | Should -Be 0 -Because "$($result.Output)`n$($result.Calls)"
    $result.Calls | Should -Match 'git merge-base --is-ancestor 2222222222222222222222222222222222222222 origin/main'
    $result.Calls | Should -Match 'docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build'
    ($result.Calls | Select-String -Pattern '(?m)^curl ' -AllMatches).Matches.Count | Should -Be 12
    $result.Output | Should -Match 'healthy.*main'
  }

  It 'restores the prior code and application images when health never passes' {
    $result = Invoke-FakeDeploy (Join-Path $TestDrive 'rollback') @{ FAKE_HEALTH = 'failed' }
    $result.ExitCode | Should -Not -Be 0
    $result.Calls | Should -Match 'git checkout --detach 1111111111111111111111111111111111111111'
    $result.Calls | Should -Match 'docker image tag sha256:backend-old standalone/backend:latest'
    $result.Calls | Should -Match 'docker image tag sha256:conversion-old standalone/conversion:latest'
    $result.Calls | Should -Match 'docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-build conversion conversion-worker backend caddy'
    $result.Output | Should -Match 'rollback'
  }

  It 'contains no destructive database, volume, secret, or hard-reset operation' {
    $content = Get-Content -LiteralPath $deploy -Raw
    $content | Should -Not -Match 'migrate\s+reset|down\s+-v|volume\s+(rm|prune)|reset\s+--hard|secret.*(rotate|delete)'
    $content | Should -Match 'ALLOW_OLDER_MAIN_COMMIT'
    $content | Should -Match 'three consecutive|HEALTH_REQUIRED_SUCCESSES="\$\{HEALTH_REQUIRED_SUCCESSES:-3\}"'
  }
}
