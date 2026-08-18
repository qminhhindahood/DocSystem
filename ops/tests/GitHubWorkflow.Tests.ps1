$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$ciPath = Join-Path $root '.github/workflows/ci.yml'
$deployPath = Join-Path $root '.github/workflows/deploy-production.yml'

function Assert-True([object]$Condition, [string]$Message) {
  if (-not [bool]$Condition) { throw "GitHub workflow invariant failed: $Message" }
}

function Read-Workflow([string]$Path) {
  Assert-True (Test-Path -LiteralPath $Path) "missing $Path"
  $python = @'
import json, pathlib, sys, yaml
with pathlib.Path(sys.argv[1]).open(encoding="utf-8") as stream:
    print(json.dumps(yaml.load(stream, Loader=yaml.BaseLoader)))
'@
  $json = & python -c $python $Path
  if ($LASTEXITCODE -ne 0) { throw "Unable to parse workflow YAML: $Path" }
  return $json | ConvertFrom-Json -Depth 100
}

$ci = Read-Workflow $ciPath
$deploy = Read-Workflow $deployPath
$ciRaw = Get-Content -LiteralPath $ciPath -Raw
$deployRaw = Get-Content -LiteralPath $deployPath -Raw

Assert-True ($ci.on.PSObject.Properties.Name -contains 'pull_request') 'CI must run for pull requests'
foreach ($job in @('backend', 'frontend', 'worker', 'renderer', 'python', 'terraform', 'containers', 'repository-contracts')) {
  Assert-True ($ci.jobs.PSObject.Properties.Name -contains $job) "missing PR job $job"
}
Assert-True ($ciRaw -notmatch 'google-github-actions/auth|id-token:\s*write') 'PR checks must not authenticate to Google Cloud'
Assert-True ($ciRaw -match 'ops/verify-all\.ps1') 'CI must exercise the canonical verifier'
Assert-True ($ciRaw -match 'Install-Module Pester -RequiredVersion 5\.7\.1') 'CI must install the Pester version required by operations tests'
Assert-True ($ciRaw -match 'fetch-depth:\s*0') 'history-sensitive migration contracts require a full checkout'
Assert-True ($ciRaw -match 'DATABASE_URL:\s*postgresql://' -and $ciRaw -match 'REDIS_URL:\s*redis://') 'backend CI must provide non-secret contract-test dependency URLs'
Assert-True ($ciRaw -match "working-directory: '\$\{\{ matrix\.service \}\}'") 'Python tests must execute from each service directory'
Assert-True (Test-Path -LiteralPath (Join-Path $root 'frontend/public')) 'frontend container build requires a tracked public directory'
Assert-True ($ciRaw -match 'cp backend/\.env\.example backend/\.env') 'repository contracts must create the gitignored Compose env file from its safe example'
Assert-True ($ciRaw -match 'docker buildx prune --all --force') 'Docling CI must release its multi-gigabyte build cache before Trivy exports the image'
Assert-True ($ciRaw -match 'aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25') 'Trivy must use the reviewed immutable post-incident SHA'
Assert-True ($ciRaw -match 'scanners:\s*vuln') 'container security gates must run the vulnerability scanner explicitly'
Assert-True ($ciRaw.Contains("severity: 'CRITICAL,HIGH'") -and $ciRaw.Contains("ignore-unfixed: 'false'") -and $ciRaw.Contains("exit-code: '1'")) 'container scans must fail on HIGH/CRITICAL findings, including unfixed findings'

Assert-True ($deploy.on.push.branches -contains 'master') 'production deploy must follow protected master'
Assert-True ($deploy.permissions.'id-token' -eq 'write' -and $deploy.permissions.contents -eq 'read') 'production permissions must be keyless and read-only'
Assert-True ($deployRaw -match 'google-github-actions/auth@v3') 'production must use Google OIDC authentication'
Assert-True ($deployRaw -notmatch 'credentials_json|GCP_CREDENTIALS|GOOGLE_CREDENTIALS|service.account.key') 'JSON service-account keys are forbidden'
Assert-True ($deployRaw -match [regex]::Escape('${{ github.sha }}')) 'images must use github.sha'
Assert-True ($deployRaw -notmatch '(?m)(image|tag)[^\r\n]*:latest') 'production must never deploy latest'
Assert-True ($deployRaw -notmatch 'setup-terraform|terraform\s+-chdir|tfplan|TF_STATE_BUCKET') 'GitHub must not read Terraform state or apply infrastructure'
Assert-True ($deploy.jobs.deploy.needs -eq 'build-images') 'deployment must follow immutable image publication directly'
Assert-True ($deploy.jobs.deploy.environment -eq 'production') 'protected production environment must gate deployment for the human Terraform apply'
Assert-True ($deployRaw -match 'Verify human-applied infrastructure release') 'deployment must verify the human-applied job definitions'
Assert-True ($deployRaw -match 'for job in docai-migrate docai-reset-password' -and $deployRaw -match 'expected_image=.*GITHUB_SHA') 'preflight must pin migration and reset jobs to the release SHA'
Assert-True ($deployRaw -notmatch '--allow-unauthenticated|--no-allow-unauthenticated') 'GitHub must not mutate Cloud Run IAM during deploy'
Assert-True ($deployRaw -notmatch 'jobs execute docai-reset-password') 'automation must never execute the break-glass reset job'
Assert-True ($deployRaw -notmatch 'smtp_from|PRODUCTION_SMTP_FROM') 'SMTP must not block the disabled-mode pilot'

$migration = $deployRaw.IndexOf('docai-migrate')
$processors = $deployRaw.IndexOf('Deploy private processing services')
$candidate = $deployRaw.IndexOf('--no-traffic')
$smoke = $deployRaw.IndexOf('smoke-production.ps1')
$promotion = $deployRaw.IndexOf('promote-traffic.ps1')
Assert-True ($migration -ge 0 -and $migration -lt $processors) 'migration must complete before service deployment'
Assert-True ($processors -lt $candidate) 'processors must deploy before candidate frontend/backend revisions'
Assert-True ($candidate -lt $smoke -and $smoke -lt $promotion) 'no-traffic candidates must pass smoke before promotion'
Assert-True ($deployRaw -match 'candidate-' -and $deployRaw -match 'revision') 'candidate revision tags are required'
Assert-True ($deployRaw.Contains('jq -r --arg tag "$tag"') -and $deployRaw.Contains('select(.tag == $tag) | .url')) 'candidate URLs must be extracted from Cloud Run JSON by tag'
Assert-True ($deployRaw -match 'test -n "\$backend_url"' -and $deployRaw -match 'test -n "\$frontend_url"') 'candidate URL discovery must fail before smoke when either URL is empty'
Assert-True ($deployRaw -match 'BACKEND_ID_TOKEN_AUDIENCE=\$backend_audience') 'tagged backend candidates must use the canonical Cloud Run service URL as ID-token audience'
Assert-True ($deployRaw -match 'TURNSTILE_SITE_KEY' -and $deployRaw -match '0x4AAAAAAEORwCGueycu4PbE') 'frontend candidate must receive the approved public Turnstile site key'
Assert-True ($deployRaw -match 'DISABLE_PUBLIC_REGISTER=false' -and $deployRaw -match 'TURNSTILE_EXPECTED_HOSTNAMES=docai\.dpdns\.org,docai-frontend-in4iwfyf6q-as\.a\.run\.app' -and $deployRaw -match 'CORS_ORIGIN=https://docai\.dpdns\.org,https://docai-frontend-in4iwfyf6q-as\.a\.run\.app') 'backend candidate must explicitly enable both custom and fallback origins'
Assert-True ($deployRaw -match '--update-env-vars "\^\|\^') 'multi-origin Cloud Run environment updates must use a delimiter absent from HTTPS URLs'
Assert-True ($deployRaw -match 'TURNSTILE_SECRET_KEY' -and $deployRaw -match 'docai-turnstile-secret-key' -and $deployRaw -match 'secretKeyRef' -and $deployRaw -match 'secretKeyRef\.key == "2"') 'backend candidate must verify the rotated Turnstile secret binding'
Assert-True ($deployRaw -match 'DOCLING_URL=.*status\.url' -and $deployRaw -match 'EMBEDDINGS_URL=.*status\.url' -and $deployRaw -match 'RENDERER_URL=.*status\.url') 'deployer must discover private service URLs before switching to the least-privilege smoke identity'
Assert-True ($deployRaw -match 'BACKEND_AUDIENCE=\$backend_audience' -and $deployRaw -match 'SMOKE_SERVICE_ACCOUNT:.*GCP_SMOKE_SERVICE_ACCOUNT') 'smoke identity must receive canonical backend audience and its own service-account address for WIF ID-token minting'
Assert-True ($deployRaw -match '-FixturePath docs/templates-gemini/6_Administrative_Forms/Giay_moi_hop_27_GM-DU\.pdf') 'production ingestion smoke must use its tracked PDF fixture'
Assert-True ($deployRaw -match '-TemplateFixturePath docs/generated-templates/quyet-dinh\.docx') 'production template smoke must use its tracked compliant DOCX fixture'
foreach ($fixturePath in @(
  'docs/templates-gemini/6_Administrative_Forms/Giay_moi_hop_27_GM-DU.pdf',
  'docs/generated-templates/quyet-dinh.docx'
)) {
  $smokeFixture = Join-Path $root $fixturePath
  Assert-True (Test-Path -LiteralPath $smokeFixture) "production smoke fixture must exist: $fixturePath"
  & git -C $root ls-files --error-unmatch -- $fixturePath 2>$null | Out-Null
  Assert-True ($LASTEXITCODE -eq 0) "production smoke fixture must be committed: $fixturePath"
}
$smokeRaw = Get-Content -LiteralPath (Join-Path $root 'ops/gcp/smoke-production.ps1') -Raw
Assert-True ($smokeRaw -match "FixturePath must reference a PDF" -and $smokeRaw -match "TemplateFixturePath must reference a DOCX") 'smoke must reject fixtures that do not match the API contracts'
Assert-True ($smokeRaw -match '\$templateFixture\s*=\s*\(Resolve-Path') 'template smoke must use its distinct tracked DOCX fixture'
Assert-True ($smokeRaw -notmatch '\[Microsoft\.PowerShell\.Commands\.WebRequestSession\]') 'smoke script must parse on Linux PowerShell before web cmdlets autoload their implementation assembly'
Assert-True ($smokeRaw -notmatch 'gcloud run services describe') 'least-privilege smoke must not require Cloud Run service metadata permissions'
Assert-True ($smokeRaw -match 'Get-IdentityHeaders \$backendAudience') 'direct candidate backend requests must use the canonical Cloud Run audience'
Assert-True ($deployRaw -match 'GITHUB_STEP_SUMMARY' -and $deployRaw -match 'digest' -and $deployRaw -match 'migration') 'release evidence must be written to the workflow summary'

foreach ($script in @('smoke-production.ps1', 'promote-traffic.ps1', 'rollback.ps1')) {
  Assert-True (Test-Path (Join-Path $root "ops/gcp/$script")) "missing operations script $script"
}
$promotionRaw = Get-Content -LiteralPath (Join-Path $root 'ops/gcp/promote-traffic.ps1') -Raw
Assert-True ($promotionRaw -match '--format=json' -and $promotionRaw -match 'ConvertFrom-Json' -and $promotionRaw -match '\.tag\s*-eq\s*\$CandidateTag') 'traffic promotion must verify the tagged candidate from structured Cloud Run JSON'

Write-Host 'PASS: GitHub CI/CD workflow contracts' -ForegroundColor Green
