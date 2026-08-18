Describe 'Repository development hygiene' {
  It 'tracks lockfiles required by clean Docker builds' {
    Test-Path -LiteralPath (Join-Path $root 'backend/package-lock.json') | Should -BeTrue
    Test-Path -LiteralPath (Join-Path $root 'frontend/package-lock.json') | Should -BeTrue
    Test-Path -LiteralPath (Join-Path $root 'cloudflare-worker/package-lock.json') | Should -BeTrue
    (& git -C $root check-ignore backend/package-lock.json frontend/package-lock.json 2>$null) | Should -BeNullOrEmpty
    (& git -C $root check-ignore cloudflare-worker/package-lock.json 2>$null) | Should -BeNullOrEmpty
  }

  BeforeAll {
    $root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
  }

  It 'declares Python test dependencies separately from runtime images' {
    foreach ($service in @('docling-service', 'embeddings-service')) {
      $content = Get-Content -LiteralPath (Join-Path $root "$service/requirements-dev.txt") -Raw
      $content | Should -Match '(?m)^-r requirements\.txt\r?$'
      $content | Should -Match '(?m)^pytest\r?$'
      $content | Should -Match '(?m)^pytest-asyncio\r?$'
      $content | Should -Match '(?m)^httpx\r?$'
    }
  }

  It 'keeps the header utility portable and removes obsolete mutation scripts' {
    $source = Get-Content -LiteralPath (Join-Path $root 'add_header.py') -Raw
    $source | Should -Not -Match 'C:\\Users\\PC|Documents\\LLM'
    $source | Should -Match '--templates-dir'
    foreach ($script in @('fix_poll.py', 'fix_rename.py', 'fix_similarity.py', 'rename_similarity.py')) {
      Test-Path -LiteralPath (Join-Path $root $script) | Should -BeFalse
    }
  }

  It 'documents the Python development install path in the verifier and README' {
    foreach ($path in @('README.md', 'ops/verify-all.ps1')) {
      $content = Get-Content -LiteralPath (Join-Path $root $path) -Raw
      $content | Should -Match 'requirements-dev\.txt'
    }
  }

  It 'pins minimal production container bases and patched embeddings dependencies' {
    $backendDockerfile = Get-Content -LiteralPath (Join-Path $root 'backend/Dockerfile') -Raw
    $backendDockerfile | Should -Match 'FROM node:22-alpine@sha256:[a-f0-9]{64}'
    $backendDockerfile | Should -Match 'rm -rf /usr/local/lib/node_modules/npm'

    $cloudRun = Get-Content -LiteralPath (Join-Path $root 'infra/terraform/cloud_run.tf') -Raw
    $cloudRun | Should -Not -Match 'command\s*=\s*\["npm"'
    $cloudRun | Should -Match 'node_modules/prisma/build/index\.js migrate deploy'

    $frontendDockerfile = Get-Content -LiteralPath (Join-Path $root 'frontend/Dockerfile') -Raw
    $frontendDockerfile | Should -Match 'FROM node:22-alpine@sha256:[a-f0-9]{64}'
    $frontendDockerfile | Should -Match 'rm -rf /usr/local/lib/node_modules/npm'

    $embeddingsDockerfile = Get-Content -LiteralPath (Join-Path $root 'embeddings-service/Dockerfile') -Raw
    $embeddingsDockerfile | Should -Match 'FROM python:3\.11-slim-bookworm@sha256:d29f48a31a8b408ed19272ca1e7b10ebae13b240a27e862d3d4217c528e2e0c3'
    $embeddingsDockerfile | Should -Match 'python -m pip uninstall --yes pip setuptools wheel'
    $embeddingsDockerfile | Should -Not -Match '\bcurl\b'

    $requirements = Get-Content -LiteralPath (Join-Path $root 'embeddings-service/requirements.txt') -Raw
    $requirements | Should -Match '(?m)^fastapi==0\.141\.1\r?$'
    $requirements | Should -Match '(?m)^python-multipart==0\.0\.32\r?$'
    $requirements | Should -Match '(?m)^transformers==5\.15\.0\r?$'
    $requirements | Should -Match '(?m)^sentence-transformers==5\.7\.0\r?$'

    $doclingDockerfile = Get-Content -LiteralPath (Join-Path $root 'docling-service/Dockerfile') -Raw
    $doclingDockerfile | Should -Match 'FROM cgr\.dev/chainguard/wolfi-base@sha256:[a-f0-9]{64}'
    $doclingDockerfile | Should -Match 'python-3\.11'
    $doclingDockerfile | Should -Not -Match 'apt-get|\bcurl\b'
    $doclingRequirements = Get-Content -LiteralPath (Join-Path $root 'docling-service/requirements.txt') -Raw
    $doclingRequirements | Should -Match '(?m)^torch==2\.13\.0\+cpu\r?$'
    $doclingRequirements | Should -Match '(?m)^torchvision==0\.28\.0\+cpu\r?$'
    $doclingDevRequirements = Get-Content -LiteralPath (Join-Path $root 'docling-service/requirements-dev.txt') -Raw
    $doclingDevRequirements | Should -Match '(?m)^--extra-index-url https://download\.pytorch\.org/whl/cpu\r?$'
  }

  It 'isolates local Terraform validation from a previously initialized remote backend' {
    $verifier = Get-Content -LiteralPath (Join-Path $root 'ops/verify-all.ps1') -Raw
    $verifier | Should -Match 'TF_DATA_DIR'
    $verifier | Should -Match 'GetTempPath'
    $verifier | Should -Match "init'\s*,\s*'-backend=false"
  }

  It 'keeps production Terraform compatible with live Google Cloud APIs' {
    $cloudRun = Get-Content -LiteralPath (Join-Path $root 'infra/terraform/cloud_run.tf') -Raw
    $cloudRun | Should -Not -Match '(?m)^[ \t]*(?-i:PORT)[ \t]*='
    ([regex]::Matches($cloudRun, 'name\s*=\s*"cloudsql"\s*\r?\n\s*mount_path\s*=\s*"/cloudsql"')).Count | Should -Be 5
    foreach ($container in @('backend', 'migrate', 'bootstrap-user', 'bootstrap-smoke-user', 'reset-password')) {
      $containerPattern = '(?s)containers\s*\{\s*name\s*=\s*"' + [regex]::Escape($container) + '"(?:(?!\r?\n\s*containers\s*\{).)*?volume_mounts\s*\{\s*name\s*=\s*"cloudsql"\s*mount_path\s*=\s*"/cloudsql"'
      ([regex]::Matches($cloudRun, $containerPattern)).Count | Should -Be 1
    }
    $cloudRun | Should -Match 'export PATH=/app/node_modules/\.bin:\$PATH\s+node dist/scripts/prepare_database\.js'
    $cloudRun | Should -Match 'replace\(\s*<<-EOT'
    $cloudRun | Should -Match 'EOT\s*,\s*"\\r"\s*,\s*""\s*\)'
    $cloudRun | Should -Not -Match 'dist/scripts/assert_owner_integrity\.js'
    $cloudRun | Should -Match 'Owner integrity verified'
    $cloudRun | Should -Match '(?s)resource "google_cloud_run_v2_service" "embeddings".*?limits\s*=\s*\{ cpu = "2", memory = "4Gi" \}'
    $cloudRun | Should -Match 'DOCLING_ASYNC_TIMEOUT_MS\s*=\s*"840000"'
    $cloudRun | Should -Match '(?s)resource "google_cloud_run_v2_service" "backend".*?ignore_changes\s*=\s*\[\s*template\[0\]\.containers\[0\]\.image\s*,\s*traffic\s*,\s*client\s*,\s*client_version\s*,?\s*\]'
    $cloudRun | Should -Not -Match 'template\[0\]\.revision'
    $cloudRun | Should -Match 'ignore_changes\s*=\s*\[client, client_version\]'
    $cloudRun | Should -Match '(?s)resource "google_cloud_run_v2_service" "renderer".*?bucket\s*=\s*google_storage_bucket\.persistent\["templates"\]\.name.*?read_only\s*=\s*false'

    $iam = Get-Content -LiteralPath (Join-Path $root 'infra/terraform/iam.tf') -Raw
    $iam | Should -Match '(?s)resource "google_storage_bucket_iam_member" "renderer_templates".*?role\s*=\s*"roles/storage\.objectAdmin"'

    $budgets = Get-Content -LiteralPath (Join-Path $root 'infra/terraform/budgets.tf') -Raw
    $budgets | Should -Not -Match 'google_project_service_identity'
    $budgets | Should -Not -Match 'google_pubsub_topic_iam_member\.billing_publisher'
    $budgets | Should -Match 'pubsub_topic\s*=\s*google_pubsub_topic\.budget\.id'
    $budgets | Should -Match 'currency_code\s*=\s*"VND"'
    $budgets | Should -Match 'units\s*=\s*"7200000"'

    $monitoring = Get-Content -LiteralPath (Join-Path $root 'infra/terraform/monitoring.tf') -Raw
    foreach ($resourceType in @('cloud_run_revision', 'cloud_run_job', 'audited_resource')) {
      $monitoring | Should -Match "resource_type\s*=\s*`"$resourceType`""
    }
    $monitoring | Should -Match 'resource\.type=\\"\$\{each\.value\.resource_type\}\\"'
    $monitoring | Should -Not -Match 'resource\.type=\\"global\\" AND metric\.type=\\"logging\.googleapis\.com/user/'
    $monitoring | Should -Match 'resource\.labels\.service_name=\\"docai-frontend\\" AND metric\.type=\\"run\.googleapis\.com/container/instance_count\\"'
    $monitoring | Should -Match 'threshold_value\s*=\s*1\.9'
    $monitoring | Should -Match '(?s)display_name\s*=\s*"DocAI Cloud Run 5xx".*?resource\.labels\.service_name=\\"docai-frontend\\".*?metric\.type=\\"run\.googleapis\.com/request_count\\"'
    $monitoring | Should -Match '(?s)display_name\s*=\s*"DocAI Cloud Run 5xx".*?duration\s*=\s*"300s"'
    $monitoring | Should -Match 'unhealthy_readiness\s*=\s*\{(?s:.*?)resource\.labels\.service_name=\\"docai-frontend\\"'
  }

  It 'loads Pester 5 explicitly before running operations tests' {
    $verifier = Get-Content -LiteralPath (Join-Path $root 'ops/verify-all.ps1') -Raw
    $verifier | Should -Match 'Pester[/\\]5\.7\.1[/\\]Pester\.psd1'
    $verifier | Should -Match 'Import-Module\s+\$pesterModulePath\s+-Force'
    $verifier.IndexOf('Import-Module $pesterModulePath -Force') | Should -BeLessThan $verifier.IndexOf('Invoke-Pester')
  }

  It 'narrows Terraform reset-identifier secret-scan exceptions to exact lines and paths' {
    $config = Get-Content -LiteralPath (Join-Path $root '.gitleaks.toml') -Raw
    $config | Should -Match 'id\s*=\s*"hashicorp-tf-password"'
    $config | Should -Match 'condition\s*=\s*"AND"'
    $config | Should -Match 'regexTarget\s*=\s*"line"'
    $config | Should -Match 'infra/terraform/\(cloud_run\|iam\)\\\.tf'
    $config | Should -Match 'PASSWORD_RESET_MODE\\s\*'
    $config | Should -Match 'password_reset\\s\*'
  }

  It 'points production operators to the SMTP-free pilot documents without advertising email recovery' {
    $readme = Get-Content -LiteralPath (Join-Path $root 'README.md') -Raw
    $readme | Should -Match '2026-08-11-gcp-smtp-free-personal-pilot-design\.md'
    $readme | Should -Match 'gcp-owner-action-guide\.md'
    $readme | Should -Match '(?i)email recovery is intentionally (disabled|unavailable)'
    $readme | Should -Not -Match '(?i)production.{0,120}(configure|enable).{0,80}SMTP'
  }
}
