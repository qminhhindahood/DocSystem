$ErrorActionPreference = 'Stop'

if (-not $env:DB_PASSWORD) { $env:DB_PASSWORD = 'compose-contract-only' }
if (-not $env:RENDERER_INTERNAL_TOKEN) { $env:RENDERER_INTERNAL_TOKEN = 'compose-contract-token-at-least-32-characters' }

$config = docker compose config --format json | ConvertFrom-Json
if (-not $config.services.'document-renderer') { throw 'document-renderer service is missing' }
if ($config.services.'document-renderer'.ports) { throw 'document-renderer must not publish a host port' }
if ($config.services.'template-service') { throw 'legacy template-service must not be present' }
if ($config.services.lora) { throw 'LoRA service must not be present' }

$backendMount = $config.services.backend.volumes | Where-Object { $_.target -eq '/data/templates' }
$rendererMount = $config.services.'document-renderer'.volumes | Where-Object { $_.target -eq '/data/templates' }
if (-not $backendMount -or -not $rendererMount) { throw 'backend and renderer must share template storage' }
if ($config.services.backend.environment.TEMPLATE_STORAGE_DIR -ne '/data/templates') { throw 'backend template storage is misconfigured' }
if ($config.services.backend.environment.DOCUMENT_RENDERER_URL -ne 'http://document-renderer:8080') { throw 'backend renderer URL is misconfigured' }
if ($config.services.'document-renderer'.healthcheck.test[-1] -notmatch '/ready') { throw 'renderer healthcheck must use fail-closed readiness' }

$renderer = $config.services.'document-renderer'
$proprietaryLicenseVariable = 'AS' + 'POSE_LICENSE_PATH'
if ($renderer.environment.$proprietaryLicenseVariable) { throw 'Proprietary renderer configuration must be absent' }
if ($renderer.volumes | Where-Object { $_.source -match 'licenses|fonts' }) { throw 'Proprietary asset mounts must be absent' }
if ($renderer.environment.RENDERER_TEMP_ROOT -ne '/tmp/document-renderer') { throw 'Renderer temp root is not isolated' }
if ([int64]$renderer.deploy.resources.limits.memory -gt 3221225472) { throw 'Renderer memory limit exceeds 3 GiB' }
if (-not $config.networks.renderer_internal.internal) { throw 'Renderer network must block external egress' }
if ($renderer.networks.PSObject.Properties.Name -contains 'default') { throw 'Renderer must not join the default network' }
if (-not $renderer.security_opt -or $renderer.security_opt -notcontains 'no-new-privileges:true') {
  throw 'Renderer must disable privilege escalation'
}
if ($renderer.cap_drop -notcontains 'ALL') { throw 'Renderer must drop all Linux capabilities' }

Write-Output 'Compose renderer contract passed.'
