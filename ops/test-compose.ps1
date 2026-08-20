$ErrorActionPreference = 'Stop'

# Standalone compose contract (tickets 05/07): one `docker compose up` runs the
# whole conversion product — database, queue, conversion, worker, backend,
# frontend — and nothing from the master stack survives in the stack definition.

if (-not $env:DB_PASSWORD) { $env:DB_PASSWORD = 'compose-contract-only' }

$config = docker compose config --format json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw "docker compose config failed with exit code $LASTEXITCODE" }

# --- Exact service set: the whole product, nothing else -----------------------
$expectedServices = @('postgres', 'redis', 'conversion', 'conversion-worker', 'migrate', 'backend', 'frontend', 'storage-init')
$actualServices = @($config.services.PSObject.Properties.Name | Sort-Object)
if (($actualServices -join ',') -ne (($expectedServices | Sort-Object) -join ',')) {
  throw "Compose service set drifted. Expected [$($expectedServices -join ', ')], got [$($actualServices -join ', ')]"
}
foreach ($dead in @('document-renderer', 'docling', 'embeddings', 'lora', 'template-service', 'nginx')) {
  if ($config.services.$dead) { throw "Master-stack service '$dead' must not be present" }
}

# --- Postgres: plain image, no vector extension (ADR-0001) --------------------
if ($config.services.postgres.image -ne 'postgres:15-alpine') { throw 'Postgres must be plain postgres:15-alpine (no pgvector)' }
if ($config.services.postgres.image -match 'pgvector') { throw 'Postgres image must not be a pgvector variant' }

# --- Conversion pair: wired to the compose Redis; worker owns the queue -------
foreach ($svc in @('conversion', 'conversion-worker')) {
  if ($config.services.$svc.environment.REDIS_URL -ne 'redis://redis:6379') { throw "$svc must use the compose Redis" }
}
if (($config.services.'conversion-worker'.command -join ' ') -notmatch 'worker\.py') { throw 'conversion-worker must run worker.py' }
if (-not $config.services.'conversion-worker'.healthcheck.disable) { throw 'conversion-worker runs no HTTP server; its healthcheck must be disabled' }

# --- Migrate: one-shot, applies the squashed auth-only migration --------------
if (($config.services.migrate.command -join ' ') -notmatch 'prisma migrate deploy') { throw 'migrate service must run prisma migrate deploy' }
if ($config.services.migrate.depends_on.postgres.condition -ne 'service_healthy') { throw 'migrate must wait for a healthy Postgres' }
if ($config.services.migrate.restart -ne 'no') { throw 'migrate must be a one-shot service' }

# --- Backend: proxies to the conversion service, waits for its dependencies ---
if ($config.services.backend.environment.CONVERSION_SERVICE_URL -ne 'http://conversion:8004') { throw 'backend must target the compose conversion service' }
foreach ($dep in @('postgres', 'redis')) {
  if ($config.services.backend.depends_on.$dep.condition -ne 'service_healthy') { throw "backend must wait for $dep readiness" }
}
if ($config.services.backend.depends_on.migrate.condition -ne 'service_completed_successfully') { throw 'backend must wait for the migration one-shot' }
$backendHealth = @($config.services.backend.healthcheck.test)
if ($backendHealth[0] -ne 'CMD' -or $backendHealth[1] -ne 'node') { throw 'backend healthcheck must probe with node (node:22-alpine ships no curl)' }

# --- Frontend: production Next.js standalone build proxying to the backend ----
$frontend = $config.services.frontend
if ($frontend.image -ne 'standalone/frontend:latest') { throw 'frontend image must be standalone/frontend:latest' }
if ($frontend.environment.BACKEND_API_URL -ne 'http://backend:3001') { throw 'frontend must proxy to the compose backend' }
if ($frontend.environment.HOSTNAME -ne '0.0.0.0') { throw 'frontend must bind the standalone Next.js server to all interfaces' }
if ($frontend.depends_on.backend.condition -ne 'service_healthy') { throw 'frontend must wait for a healthy backend' }
$frontendHealth = @($frontend.healthcheck.test)
if ($frontendHealth[0] -ne 'CMD' -or $frontendHealth[1] -ne 'node') { throw 'frontend healthcheck must probe with node (node:22-alpine ships no curl)' }
if (($frontendHealth -join ' ') -notmatch '/api/live') { throw 'frontend healthcheck must use the self-contained /api/live probe' }
if ($frontend.ports[0].host_ip -ne '127.0.0.1') { throw 'frontend must publish only on the loopback interface' }
if ([int]$frontend.ports[0].target -ne 3000) { throw 'frontend must serve on container port 3000' }

# --- Isolation: standalone volume names never collide with the master stack ---
if ($config.volumes.postgres_data.name -notmatch '^standalone_') { throw 'Postgres volume must use the standalone_ prefix' }
if ($config.volumes.redis_data.name -notmatch '^standalone_') { throw 'Redis volume must use the standalone_ prefix' }

Write-Output 'Standalone compose contract passed.'
