BeforeAll {
  $root = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path
  $collector = Join-Path $root 'ops/monitoring/collect-health.sh'
  $publisher = Join-Path $root 'ops/monitoring/publish-oci-metrics.sh'
  $serviceUnit = Join-Path $root 'ops/systemd/docai-monitor.service'
  $timerUnit = Join-Path $root 'ops/systemd/docai-monitor.timer'
  $gitBash = 'C:\Program Files\Git\bin\bash.exe'
  $python = (Get-Command python -ErrorAction Stop).Source

  function ConvertTo-BashPath([string]$Path) {
    return ([System.IO.Path]::GetFullPath($Path)).Replace('\', '/')
  }
}

Describe 'production health collector' {
  It 'exists and emits the four agreed metric names' {
    Test-Path -LiteralPath $collector | Should -BeTrue
    $content = Get-Content -LiteralPath $collector -Raw
    foreach ($name in @('queue_depth', 'disk_used_percent', 'backup_age_seconds', 'unhealthy_container_count')) {
      $content | Should -Match $name
    }
  }

  It 'collects deterministic numeric health with fake host commands' {
    $fakeDir = Join-Path $TestDrive 'fake-monitor-bin'
    New-Item -ItemType Directory -Path $fakeDir | Out-Null
    $docker = Join-Path $fakeDir 'docker'
    $df = Join-Path $fakeDir 'df'
    $date = Join-Path $fakeDir 'date'
    $find = Join-Path $fakeDir 'find'
    Set-Content -LiteralPath $docker -NoNewline -Value @'
#!/usr/bin/env bash
case "$*" in
  *"compose exec"*) echo 7 ;;
  *"compose ps -q postgres"*) echo healthy-id ;;
  *"compose ps -q redis"*) echo unhealthy-id ;;
  *"compose ps -q conversion"*) echo healthy-id ;;
  *"compose ps -q conversion-worker"*) echo healthy-id ;;
  *"compose ps -q backend"*) echo healthy-id ;;
  *"compose ps -q caddy"*) echo healthy-id ;;
  *"inspect"*"unhealthy-id"*) echo unhealthy ;;
  *"inspect"*"healthy-id"*) echo healthy ;;
  *) exit 2 ;;
esac
'@
    Set-Content -LiteralPath $df -NoNewline -Value "#!/usr/bin/env bash`nprintf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/test 100 85 15 85%% /\n'`n"
    Set-Content -LiteralPath $date -NoNewline -Value "#!/usr/bin/env bash`necho 200000`n"
    Set-Content -LiteralPath $find -NoNewline -Value "#!/usr/bin/env bash`necho 100000`n"
    $paths = @($docker, $df, $date, $find) | ForEach-Object { ConvertTo-BashPath $_ }
    $collectorBash = ConvertTo-BashPath $collector
    $output = & $gitBash -lc "chmod +x '$($paths -join "' '")' && env DOCKER_BIN='$($paths[0])' DF_BIN='$($paths[1])' DATE_BIN='$($paths[2])' FIND_BIN='$($paths[3])' bash '$collectorBash'" 2>&1
    $LASTEXITCODE | Should -Be 0 -Because ($output -join "`n")
    $health = $output -join "`n" | ConvertFrom-Json
    $health.queue_depth | Should -Be 7
    $health.disk_used_percent | Should -Be 85
    $health.backup_age_seconds | Should -Be 100000
    $health.unhealthy_container_count | Should -Be 1
    @($health.PSObject.Properties.Name | Sort-Object) | Should -Be @(
      'backup_age_seconds',
      'disk_used_percent',
      'queue_depth',
      'unhealthy_container_count'
    )
  }

  It 'checks only required long-running services, not successful one-shot containers' {
    $content = Get-Content -LiteralPath $collector -Raw
    foreach ($service in @('postgres', 'redis', 'conversion', 'conversion-worker', 'backend', 'caddy')) {
      $content | Should -Match ([regex]::Escape($service))
    }
    $content | Should -Not -Match 'compose ps -a'
  }
}

Describe 'OCI metric publisher' {
  It 'requires a compartment and publishes the docai namespace' {
    Test-Path -LiteralPath $publisher | Should -BeTrue
    $content = Get-Content -LiteralPath $publisher -Raw
    $content | Should -Match 'OCI_MONITORING_COMPARTMENT_ID'
    $content | Should -Match 'docai'
    $content | Should -Match 'metric-data post'
  }

  It 'publishes an atomic four-metric payload with instance-principal auth' {
    $fakeDir = Join-Path $TestDrive 'fake-publisher-bin'
    New-Item -ItemType Directory -Path $fakeDir | Out-Null
    $collectorFake = Join-Path $fakeDir 'collector'
    $ociFake = Join-Path $fakeDir 'oci'
    $capture = Join-Path $TestDrive 'payload.json'
    $calls = Join-Path $TestDrive 'oci-calls.log'
    Set-Content -LiteralPath $collectorFake -NoNewline -Value @'
#!/usr/bin/env bash
echo '{"queue_depth":7,"disk_used_percent":85,"backup_age_seconds":100000,"unhealthy_container_count":1}'
'@
    Set-Content -LiteralPath $ociFake -NoNewline -Value @'
#!/usr/bin/env bash
echo "$*" > "$OCI_CALLS"
while [[ "$#" -gt 0 ]]; do
  if [[ "$1" == "--metric-data" ]]; then
    shift
    cp "${1#file://}" "$PAYLOAD_CAPTURE"
    exit 0
  fi
  shift
done
exit 2
'@
    $collectorBash = ConvertTo-BashPath $collectorFake
    $ociBash = ConvertTo-BashPath $ociFake
    $publisherBash = ConvertTo-BashPath $publisher
    $captureBash = ConvertTo-BashPath $capture
    $callsBash = ConvertTo-BashPath $calls
    $pythonBash = ConvertTo-BashPath $python
    $output = & $gitBash -lc "chmod +x '$collectorBash' '$ociBash' && env COLLECTOR_BIN='$collectorBash' OCI_BIN='$ociBash' PYTHON_BIN='$pythonBash' PAYLOAD_CAPTURE='$captureBash' OCI_CALLS='$callsBash' OCI_MONITORING_COMPARTMENT_ID='ocid1.compartment.test' MONITORING_HOST='docai-a1' MONITORING_SERVICE='conversion' bash '$publisherBash'" 2>&1
    $LASTEXITCODE | Should -Be 0 -Because ($output -join "`n")
    $payload = Get-Content -LiteralPath $capture -Raw | ConvertFrom-Json
    @($payload).Count | Should -Be 4
    @($payload.name | Sort-Object) | Should -Be @('backup_age_seconds', 'disk_used_percent', 'queue_depth', 'unhealthy_container_count')
    foreach ($metric in $payload) {
      $metric.namespace | Should -Be 'docai'
      $metric.compartmentId | Should -Be 'ocid1.compartment.test'
      $metric.dimensions.host | Should -Be 'docai-a1'
      $metric.dimensions.service | Should -Be 'conversion'
    }
    $call = Get-Content -LiteralPath $calls -Raw
    $call | Should -Match 'monitoring metric-data post'
    $call | Should -Match '--auth instance_principal'
    $call | Should -Match '--batch-atomicity ATOMIC'
  }

  It 'refuses malformed collector values before invoking OCI' {
    $fakeDir = Join-Path $TestDrive 'fake-malformed-bin'
    New-Item -ItemType Directory -Path $fakeDir | Out-Null
    $collectorFake = Join-Path $fakeDir 'collector'
    $ociFake = Join-Path $fakeDir 'oci'
    $called = Join-Path $TestDrive 'malformed-oci-called'
    Set-Content -LiteralPath $collectorFake -NoNewline -Value "#!/usr/bin/env bash`necho '{`"queue_depth`":`"many`"}'`n"
    Set-Content -LiteralPath $ociFake -NoNewline -Value "#!/usr/bin/env bash`ntouch '$((ConvertTo-BashPath $called))'`n"
    $collectorBash = ConvertTo-BashPath $collectorFake
    $ociBash = ConvertTo-BashPath $ociFake
    $publisherBash = ConvertTo-BashPath $publisher
    $pythonBash = ConvertTo-BashPath $python
    $output = & $gitBash -lc "chmod +x '$collectorBash' '$ociBash' && env COLLECTOR_BIN='$collectorBash' OCI_BIN='$ociBash' PYTHON_BIN='$pythonBash' OCI_MONITORING_COMPARTMENT_ID='ocid1.compartment.test' bash '$publisherBash'" 2>&1
    $LASTEXITCODE | Should -Not -Be 0
    Test-Path -LiteralPath $called | Should -BeFalse
  }
}

Describe 'monitoring systemd units' {
  It 'installs the publisher every five minutes with a root-only environment file' {
    Test-Path -LiteralPath $serviceUnit | Should -BeTrue
    Test-Path -LiteralPath $timerUnit | Should -BeTrue
    $service = Get-Content -LiteralPath $serviceUnit -Raw
    $timer = Get-Content -LiteralPath $timerUnit -Raw
    $service | Should -Match 'EnvironmentFile=/etc/docai-monitor\.env'
    $service | Should -Match 'ExecStart=/opt/conversion-service-standalone/ops/monitoring/publish-oci-metrics\.sh'
    $timer | Should -Match 'OnUnitActiveSec=5m'
    $timer | Should -Match 'Persistent=true'
  }
}
