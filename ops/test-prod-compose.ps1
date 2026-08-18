$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$composeFile = Join-Path $root 'deploy/docker-compose.prod.yml'
$nginxConfig = Join-Path $root 'deploy/nginx/default.conf.template'

if (-not $env:DB_URL) { $env:DB_URL = 'postgresql://review:review@db.invalid:5432/docai' }
if (-not $env:JWT_SECRET) { $env:JWT_SECRET = 'production-contract-jwt-secret-32-chars' }
if (-not $env:LLM_CONFIG_ENCRYPTION_KEY) { $env:LLM_CONFIG_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' } # gitleaks:allow -- deterministic contract-test key
if (-not $env:RENDERER_INTERNAL_TOKEN) { $env:RENDERER_INTERNAL_TOKEN = 'production-contract-renderer-token' }
if (-not $env:JINA_API_KEY) { $env:JINA_API_KEY = 'contract-jina-key' }
if (-not $env:CORS_ORIGIN) { $env:CORS_ORIGIN = 'https://example.invalid' }
if (-not $env:DOMAIN) { $env:DOMAIN = 'example.invalid' }
if (-not $env:TURNSTILE_SITE_KEY) { $env:TURNSTILE_SITE_KEY = '1x00000000000000000000AA' }
if (-not $env:TURNSTILE_SECRET_KEY) { $env:TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA' }

$configText = & docker compose -f $composeFile config --format json
if ($LASTEXITCODE -ne 0) { throw "Production Compose config failed with exit code $LASTEXITCODE" }
$config = ($configText -join "`n") | ConvertFrom-Json

foreach ($serviceName in @('frontend', 'backend', 'docling', 'embeddings', 'document-renderer', 'nginx')) {
  $context = $config.services.$serviceName.build.context
  if (-not $context -or -not (Test-Path -LiteralPath $context -PathType Container)) {
    throw "Missing production build context: $serviceName -> $context"
  }
}

$nginx = Get-Content -LiteralPath $nginxConfig -Raw
foreach ($namespace in @('session', 'proxy', 'analytics')) {
  if ($nginx -notmatch "location\s+(?:\^~\s+)?/api/$namespace/") {
    throw "Nginx does not route /api/$namespace/ explicitly through the frontend BFF"
  }
}
if ($nginx -notmatch 'location\s+/api/\s*\{[^}]*proxy_pass\s+http://backend:3001' ) {
  throw 'Nginx generic /api/ route does not target the backend'
}

foreach ($serviceName in @('backend', 'docling', 'embeddings', 'document-renderer')) {
  $test = @($config.services.$serviceName.healthcheck.test)
  if ($test.Count -lt 2 -or $test[1] -ne 'curl') {
    throw "$serviceName healthcheck must use the curl executable installed by its Dockerfile"
  }
}

if ($config.services.backend.environment.DISABLE_PUBLIC_REGISTER -ne 'false') {
  throw 'Production registration must be explicitly enabled'
}
if (-not $config.services.backend.environment.TURNSTILE_SECRET_KEY -or
    $config.services.backend.environment.TURNSTILE_EXPECTED_HOSTNAMES -ne $env:DOMAIN -or
    $config.services.frontend.environment.TURNSTILE_SITE_KEY -ne $env:TURNSTILE_SITE_KEY) {
  throw 'Production registration must include complete Turnstile configuration'
}
foreach ($legacyLlmVariable in @('LM_STUDIO_URL', 'LM_STUDIO_MODEL', 'LM_STUDIO_API_KEY')) {
  if ($config.services.backend.environment.PSObject.Properties.Name -contains $legacyLlmVariable) {
    throw "Production must use per-user LLM settings, not $legacyLlmVariable"
  }
}
if ($config.services.backend.environment.UPLOAD_DIR -ne '/data/uploads') {
  throw 'Production upload storage path is not configured'
}
$uploadMount = $config.services.backend.volumes | Where-Object { $_.target -eq '/data/uploads' }
if (-not $uploadMount -or $uploadMount.type -ne 'volume') {
  throw 'Production uploads must use a persistent named volume'
}
foreach ($dependency in @('redis', 'docling', 'embeddings', 'document-renderer')) {
  if ($config.services.backend.depends_on.$dependency.condition -ne 'service_healthy') {
    throw "Backend must wait for $dependency readiness"
  }
}

$rendererDependency = $config.services.backend.depends_on.'document-renderer'
if (-not $rendererDependency -or $rendererDependency.condition -ne 'service_healthy') {
  throw 'Backend must wait for renderer readiness'
}
if (-not $config.networks.renderer_internal.internal) {
  throw 'Renderer network must remain internal'
}

$certMount = $config.services.nginx.volumes | Where-Object { $_.target -eq '/etc/letsencrypt' }
$expectedCertSource = [IO.Path]::GetFullPath((Join-Path $root 'deploy/nginx/letsencrypt'))
if (-not $certMount -or [IO.Path]::GetFullPath($certMount.source) -ne $expectedCertSource) {
  throw "Nginx certificate source must resolve to $expectedCertSource"
}

foreach ($header in @('Content-Security-Policy', 'Strict-Transport-Security', 'Permissions-Policy')) {
  if ($nginx -notmatch [regex]::Escape($header)) { throw "Nginx is missing $header" }
}
foreach ($script in @('deploy/tls-bootstrap.sh', 'deploy/tls-renew.sh')) {
  if (-not (Test-Path -LiteralPath (Join-Path $root $script))) { throw "Missing TLS operation: $script" }
}
$tlsBootstrap = Get-Content -LiteralPath (Join-Path $root 'deploy/tls-bootstrap.sh') -Raw
foreach ($parameter in @('DOMAIN', 'LETSENCRYPT_EMAIL')) {
  $needle = '${' + $parameter + ':?'
  if (-not $tlsBootstrap.Contains($needle)) { throw "TLS bootstrap must require $parameter" }
}

foreach ($serviceName in @('nginx', 'frontend', 'backend', 'redis', 'docling', 'embeddings', 'document-renderer')) {
  $service = $config.services.$serviceName
  if (-not $service.read_only) { throw "$serviceName root filesystem must be read-only" }
  if ($service.cap_drop -notcontains 'ALL') { throw "$serviceName must drop Linux capabilities" }
  if ($service.security_opt -notcontains 'no-new-privileges:true') {
    throw "$serviceName must disable privilege escalation"
  }
  if (-not $service.deploy.resources.limits.pids) { throw "$serviceName must set a PID limit" }
  if ($service.logging.options.'max-size' -ne '10m' -or $service.logging.options.'max-file' -ne '3') {
    throw "$serviceName must rotate json-file logs"
  }
}

if ($config.services.'document-renderer'.user -ne '1654:1654') {
  throw 'Renderer must run with its image UID and GID'
}
if (@($config.services.'document-renderer'.tmpfs) -notmatch 'uid=1654,gid=1654') {
  throw 'Renderer tmpfs must be writable only by the renderer UID/GID'
}

Write-Output 'Production Compose and Nginx contract passed.'
