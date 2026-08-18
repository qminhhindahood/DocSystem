param(
  [string]$PlanPath = (Join-Path (Split-Path $PSScriptRoot -Parent | Split-Path -Parent) 'infra/terraform/tfplan')
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $PlanPath)) {
  Write-Host "SKIP: Terraform plan not found at $PlanPath"
  return
}

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw "Terraform plan invariant failed: $Message" }
}

function Find-Terraform {
  $command = Get-Command terraform -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $candidate = Get-ChildItem "$env:LOCALAPPDATA/Microsoft/WinGet/Packages" -Recurse -Filter terraform.exe -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $candidate) { throw 'Terraform executable not found' }
  return $candidate.FullName
}

$terraform = Find-Terraform
$resolvedPlan = (Resolve-Path -LiteralPath $PlanPath).Path
$planDirectory = Split-Path $resolvedPlan -Parent
$planFileName = Split-Path $resolvedPlan -Leaf
$raw = & $terraform "-chdir=$planDirectory" show -json $planFileName
if ($LASTEXITCODE -ne 0) { throw 'terraform show failed' }
$plan = $raw | ConvertFrom-Json -Depth 100
$changes = @($plan.resource_changes)

function Get-Change([string]$Address) {
  $change = $changes | Where-Object address -eq $Address | Select-Object -First 1
  if (-not $change) { throw "Missing planned resource $Address" }
  return $change.change.after
}

$allowedSecurityCleanupDeletes = @(
  'google_billing_account_iam_member.deployer_budget',
  'google_project_iam_custom_role.secret_deployer',
  'google_project_iam_member.deployer_secret_metadata'
)
$unexpectedDeletes = @($changes | Where-Object {
  $_.change.actions -contains 'delete' -and
  $_.address -notlike 'google_project_iam_member.deployer_project_roles*' -and
  $_.address -notin $allowedSecurityCleanupDeletes
})
$unexpectedDeleteAddresses = @($unexpectedDeletes | ForEach-Object { $_.address })
Assert-True ($unexpectedDeletes.Count -eq 0) "unexpected planned deletes: $($unexpectedDeleteAddresses -join ', ')"

$expectedServices = @{
  backend    = @{ min = 1; max = 1; concurrency = 20; timeout = '900s'; cpuIdle = $false; memory = '2Gi'; probe = '/live' }
  frontend   = @{ min = 0; max = 2; concurrency = 40; timeout = '900s'; cpuIdle = $true; memory = '512Mi'; probe = '/api/live' }
  docling    = @{ min = 0; max = 1; concurrency = 1; timeout = '900s'; cpuIdle = $true; memory = '4Gi'; probe = '/live' }
  embeddings = @{ min = 0; max = 1; concurrency = 10; timeout = '180s'; cpuIdle = $true; memory = '256Mi'; probe = '/live' }
  renderer   = @{ min = 0; max = 1; concurrency = 1; timeout = '300s'; cpuIdle = $true; memory = '3Gi'; probe = '/live' }
}

foreach ($name in $expectedServices.Keys) {
  $service = Get-Change "google_cloud_run_v2_service.$name"
  $expected = $expectedServices[$name]
  $template = $service.template[0]
  $container = $template.containers[0]
  Assert-True ($service.location -eq 'asia-southeast1') "$name must run in asia-southeast1"
  Assert-True ($template.scaling[0].min_instance_count -eq $expected.min) "$name minimum instances"
  Assert-True ($template.scaling[0].max_instance_count -eq $expected.max) "$name maximum instances"
  Assert-True ($template.max_instance_request_concurrency -eq $expected.concurrency) "$name concurrency"
  Assert-True ($template.timeout -eq $expected.timeout) "$name timeout"
  Assert-True ($container.resources[0].cpu_idle -eq $expected.cpuIdle) "$name CPU allocation mode"
  Assert-True ($container.resources[0].limits.memory -eq $expected.memory) "$name memory limit"
  Assert-True ($container.startup_probe[0].http_get[0].path -eq $expected.probe) "$name startup probe"
  Assert-True ($container.liveness_probe[0].http_get[0].path -eq $expected.probe) "$name liveness probe"
  Assert-True ($container.image -notmatch ':latest$') "$name image must not use latest"
  Assert-True ($container.image -match ':[a-f0-9]{7,40}$') "$name image must use an immutable Git SHA"
  Assert-True ($template.service_account -match "docai-(frontend|backend|docling|embeddings|renderer)@") "$name must use a named runtime identity"
}

$publicBinding = Get-Change 'google_cloud_run_v2_service_iam_member.frontend_public'
Assert-True ($publicBinding.member -eq 'allUsers' -and $publicBinding.name -eq 'docai-frontend') 'only frontend is public'
$allPublicBindings = @($changes | Where-Object type -eq 'google_cloud_run_v2_service_iam_member' |
  Where-Object { $_.change.after.member -eq 'allUsers' })
Assert-True ($allPublicBindings.Count -eq 1) 'there must be exactly one allUsers Cloud Run binding'

$deployerSecretAccess = @($changes | Where-Object {
  $_.change.after.member -like 'serviceAccount:docai-github-deployer@*' -and
  $_.change.after.role -eq 'roles/secretmanager.secretAccessor'
})
Assert-True ($deployerSecretAccess.Count -eq 0) 'deployer must not read runtime secret payloads'

$runDeployer = Get-Change 'google_project_iam_custom_role.cloud_run_deployer'
foreach ($permission in @(
  'run.services.create', 'run.services.update',
  'run.jobs.create', 'run.jobs.update',
  'run.executions.get', 'run.operations.get'
)) {
  Assert-True ($runDeployer.permissions -contains $permission) "Cloud Run deployer missing $permission"
}
Assert-True ($runDeployer.permissions -notcontains 'run.jobs.run') 'deployer must not execute jobs project-wide'
Assert-True ($runDeployer.permissions -notcontains 'run.jobs.runWithOverrides') 'deployer must not execute jobs with overrides'
Assert-True ($runDeployer.permissions -notcontains 'run.jobs.setIamPolicy') 'deployer must not change job IAM'
Assert-True ($runDeployer.permissions -notcontains 'run.services.setIamPolicy') 'deployer must not change service IAM'

$deployerRunAdmin = @($changes | Where-Object {
  $_.type -eq 'google_project_iam_member' -and
  $_.change.after.member -like 'serviceAccount:docai-github-deployer@*' -and
  $_.change.after.role -eq 'roles/run.admin'
})
Assert-True ($deployerRunAdmin.Count -eq 0) 'deployer must not hold project-wide Cloud Run Admin'

$deployerProjectRoles = @($changes | Where-Object {
  ($_.address -like 'google_project_iam_member.deployer_project_roles*') -and
  ($null -ne $_.change.after)
})
Assert-True ($deployerProjectRoles.Count -eq 0) 'deployer must hold no predefined project role'

$deployerRegistryWriter = Get-Change 'google_artifact_registry_repository_iam_member.deployer_writer'
Assert-True ($deployerRegistryWriter.repository -eq 'docai') 'deployer image writes must be scoped to the docai repository'
Assert-True ($deployerRegistryWriter.role -eq 'roles/artifactregistry.writer' -and $deployerRegistryWriter.member -like 'serviceAccount:docai-github-deployer@*') 'deployer repository writer binding'

$deployerBudget = @($changes | Where-Object {
  $_.address -eq 'google_billing_account_iam_member.deployer_budget' -and $null -ne $_.change.after
})
Assert-True ($deployerBudget.Count -eq 0) 'GitHub must not manage billing or budgets'

$deployerSecretMetadata = @($changes | Where-Object {
  $_.address -eq 'google_project_iam_member.deployer_secret_metadata' -and $null -ne $_.change.after
})
Assert-True ($deployerSecretMetadata.Count -eq 0) 'GitHub must not manage Secret Manager metadata or IAM'

$deployerActAs = @($changes | Where-Object {
  $_.address -like 'google_service_account_iam_member.deployer_service_account_user*'
} | ForEach-Object {
  if ($_.address -match '\["([^"]+)"\]$') { $Matches[1] }
} | Sort-Object)
Assert-True (($deployerActAs -join ',') -eq 'backend,docling,embeddings,frontend,migration,renderer,smoke') 'deployer must not act as the reset identity'

$deployerJobInvokers = @($changes | Where-Object {
  $_.type -eq 'google_cloud_run_v2_job_iam_member' -and
  $_.change.after.member -like 'serviceAccount:docai-github-deployer@*' -and
  $_.change.after.role -eq 'roles/run.invoker'
} | ForEach-Object { $_.change.after.name } | Sort-Object)
Assert-True (($deployerJobInvokers -join ',') -eq 'docai-bootstrap-smoke-user,docai-migrate') 'deployer may invoke only migration and smoke-bootstrap jobs'

$operatorJobRoles = @($changes | Where-Object {
  $_.type -eq 'google_cloud_run_v2_job_iam_member' -and
  $_.change.after.member -eq 'user:mnqminh@gmail.com'
})
Assert-True ($operatorJobRoles.Count -eq 1) 'operator must have exactly one Cloud Run job binding'
Assert-True ($operatorJobRoles[0].change.after.name -eq 'docai-reset-password' -and $operatorJobRoles[0].change.after.role -eq 'roles/run.developer') 'operator may develop only the reset job'

$operatorActAs = Get-Change 'google_service_account_iam_member.operator_reset_act_as'
Assert-True ($operatorActAs.member -eq 'user:mnqminh@gmail.com' -and $operatorActAs.role -eq 'roles/iam.serviceAccountUser') 'operator may act as only the dedicated reset identity'

$operatorSecretRoles = @($changes | Where-Object {
  $_.type -eq 'google_secret_manager_secret_iam_member' -and
  $_.change.after.member -eq 'user:mnqminh@gmail.com'
} | ForEach-Object { $_.change.after.role } | Sort-Object)
Assert-True (($operatorSecretRoles -join ',') -eq 'roles/secretmanager.secretVersionAdder,roles/secretmanager.secretVersionManager') 'operator temporary-secret roles'
Assert-True (-not ($operatorSecretRoles -contains 'roles/secretmanager.secretAccessor')) 'operator must not read temporary secret payloads'

$serviceAccounts = @($changes | Where-Object type -eq 'google_service_account' | ForEach-Object { $_.change.after.account_id })
foreach ($identity in @('docai-frontend', 'docai-backend', 'docai-docling', 'docai-embeddings', 'docai-renderer', 'docai-migration', 'docai-github-deployer', 'docai-password-reset')) {
  Assert-True ($serviceAccounts -contains $identity) "missing service account $identity"
}

$backend = Get-Change 'google_cloud_run_v2_service.backend'
$backendEnv = @($backend.template[0].containers[0].env)
Assert-True (($backendEnv | Where-Object name -eq 'PASSWORD_RESET_MODE').value -eq 'disabled') 'backend reset mode must be disabled'
Assert-True (($backendEnv | Where-Object name -eq 'DISABLE_PUBLIC_REGISTER').value -eq 'false') 'backend public registration must be explicitly enabled'
Assert-True (($backendEnv | Where-Object name -eq 'TURNSTILE_EXPECTED_HOSTNAMES').value -eq 'docai-frontend-in4iwfyf6q-as.a.run.app') 'backend Turnstile hostname binding'
Assert-True (($backendEnv | Where-Object name -eq 'TURNSTILE_SECRET_KEY').value_source[0].secret_key_ref[0].secret -eq 'docai-turnstile-secret-key') 'backend Turnstile secret binding'
Assert-True (-not ($backendEnv.name -contains 'PASSWORD_RESET_BASE_URL')) 'backend must not configure a password reset URL'
Assert-True (-not ($backendEnv.name -contains 'SMTP_USER')) 'backend must not mount SMTP_USER'
Assert-True (-not ($backendEnv.name -contains 'SMTP_PASS')) 'backend must not mount SMTP_PASS'
Assert-True (-not ($backendEnv.name -contains 'SMTP_HOST')) 'backend must not configure SMTP_HOST'

$frontend = Get-Change 'google_cloud_run_v2_service.frontend'
$frontendEnv = @($frontend.template[0].containers[0].env)
Assert-True (($frontendEnv | Where-Object name -eq 'PASSWORD_RESET_MODE').value -eq 'disabled') 'frontend reset mode must be disabled'
Assert-True (($frontendEnv | Where-Object name -eq 'TURNSTILE_SITE_KEY').value) 'frontend must receive the public Turnstile site key'

$resetJob = Get-Change 'google_cloud_run_v2_job.reset_password'
$resetTemplate = $resetJob.template[0].template[0]
$resetContainer = $resetTemplate.containers[0]
Assert-True ($resetJob.name -eq 'docai-reset-password') 'reset job name'
Assert-True ($resetJob.location -eq 'asia-southeast1') 'reset job region'
Assert-True ($resetTemplate.max_retries -eq 0) 'reset job cannot retry'
Assert-True ($resetContainer.args -contains 'dist/scripts/reset_operator_password.js') 'reset job command'
Assert-True ($resetContainer.env.name -contains 'RESET_USERNAME') 'reset job must bind bootstrap username'
Assert-True (-not ($resetContainer.env.name -contains 'RESET_PASSWORD')) 'baseline reset job must not retain a password binding'
Assert-True ($resetTemplate.service_account -match '^docai-password-reset@') 'reset job must use its dedicated identity'

$resetProjectRoles = @($changes | Where-Object {
  $_.type -eq 'google_project_iam_member' -and $_.change.after.member -like 'serviceAccount:docai-password-reset@*'
} | ForEach-Object { $_.change.after.role } | Sort-Object)
Assert-True (($resetProjectRoles -join ',') -eq 'roles/cloudsql.client,roles/logging.logWriter') 'reset identity project roles'

$adminResetReaders = @($changes | Where-Object {
  $_.address -eq 'google_secret_manager_secret_iam_member.password_reset_external["admin-reset-password"]'
})
Assert-True ($adminResetReaders.Count -eq 1) 'temporary reset secret must have exactly one runtime reader'
Assert-True ($adminResetReaders[0].change.after.member -like 'serviceAccount:docai-password-reset@*') 'only reset identity may read temporary reset secret'

$failedJobMetric = Get-Change 'google_logging_metric.operational_failures["failed_job"]'
Assert-True ($failedJobMetric.filter -match 'resource\.labels\.job_name="docai-reset-password"') 'reset job failures must feed the failed-job metric'
Assert-True ($plan.output_changes.password_reset_job.after -eq 'docai-reset-password') 'reset job output must expose the approved name'

$backendVolumes = @($backend.template[0].volumes)
Assert-True (($backendVolumes.name | Sort-Object) -join ',' -eq 'cloudsql,rag-state,templates,uploads') 'backend Cloud SQL and GCS volumes'
Assert-True ((@($backend.template[0].containers[0].volume_mounts).mount_path | Sort-Object) -join ',' -eq '/data/rag-state,/data/templates,/data/uploads') 'backend persistent mount paths'

$secretRefs = @($backend.template[0].containers[0].env | ForEach-Object {
  if ($_.value_source -and $_.value_source[0].secret_key_ref) { $_.value_source[0].secret_key_ref[0] }
})
$externalRefs = @($secretRefs | Where-Object secret -ne 'docai-database-url')
Assert-True ((@($externalRefs.secret | Sort-Object) -join ',') -eq 'docai-jwt-secret,docai-llm-config-encryption-key,docai-redis-url,docai-renderer-internal-token,docai-turnstile-secret-key') 'backend must reference exactly the non-SMTP runtime secrets'
foreach ($reference in $externalRefs) {
  Assert-True ($reference.version -match '^\d+$') "secret $($reference.secret) must use an explicit numeric version"
}

$sql = Get-Change 'google_sql_database_instance.main'
$sqlSettings = $sql.settings[0]
$backup = $sqlSettings.backup_configuration[0]
Assert-True ($sql.database_version -eq 'POSTGRES_15') 'Cloud SQL PostgreSQL version'
Assert-True ($sql.deletion_protection -and $sqlSettings.deletion_protection_enabled) 'Cloud SQL deletion protection'
Assert-True ($sqlSettings.tier -eq 'db-g1-small') 'Cloud SQL tier'
Assert-True ($sqlSettings.disk_type -eq 'PD_SSD' -and $sqlSettings.disk_size -eq 10 -and -not $sqlSettings.disk_autoresize) 'Cloud SQL disk guardrails'
Assert-True ($backup.enabled -and $backup.point_in_time_recovery_enabled) 'Cloud SQL backup and PITR'
Assert-True ($backup.backup_retention_settings[0].retained_backups -eq 7) 'seven retained backups'

$buckets = @($changes | Where-Object type -eq 'google_storage_bucket' | ForEach-Object { $_.change.after })
Assert-True ($buckets.Count -eq 3) 'exactly three persistent buckets'
foreach ($bucket in $buckets) {
  Assert-True ($bucket.location -eq 'ASIA-SOUTHEAST1') "$($bucket.name) region"
  Assert-True ($bucket.uniform_bucket_level_access -and $bucket.public_access_prevention -eq 'enforced') "$($bucket.name) access controls"
}
foreach ($name in @('templates', 'uploads')) {
  $bucket = $buckets | Where-Object name -like "docai-$name-*"
  Assert-True ($bucket.versioning[0].enabled) "$name versioning"
  Assert-True ($bucket.lifecycle_rule[0].condition[0].days_since_noncurrent_time -eq 30) "$name noncurrent retention"
}

$wif = Get-Change 'google_iam_workload_identity_pool_provider.github'
Assert-True ($wif.attribute_condition -match "attribute.repository == 'qminhhindahood/DocAI'") 'WIF exact repository restriction'
Assert-True ($wif.attribute_condition -match "attribute.ref == 'refs/heads/master'") 'WIF master branch restriction'

$budget = Get-Change 'google_billing_budget.pilot'
Assert-True ($budget.amount[0].specified_amount[0].units -eq '275') 'budget ceiling is $275'
Assert-True ($budget.budget_filter[0].credit_types_treatment -eq 'EXCLUDE_ALL_CREDITS') 'budget must measure gross trial-credit consumption'
$thresholdDollars = @($budget.threshold_rules | ForEach-Object { [math]::Round($_.threshold_percent * 275) })
Assert-True (($thresholdDollars -join ',') -eq '50,150,225,275') 'budget thresholds are $50, $150, $225, and $275'
Assert-True ($budget.all_updates_rule[0].schema_version -eq '1.0') 'budget Pub/Sub notifications configured'

Write-Host "PASS: rendered Terraform plan invariants ($($changes.Count) resource changes)" -ForegroundColor Green
