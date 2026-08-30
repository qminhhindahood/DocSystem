# Operations Runbook — Standalone Conversion Service

How to operate the pilot deployment (Oracle Always Free ARM VM, one domain on
Cloudflare — ADR-0002). Sections 6–7 are filled by tickets 06–07.

## 1. Nightly Postgres backup

Cron on the VM (root):

```
0 3 * * * /opt/conversion-service-standalone/ops/backup/postgres-dump.sh >> /var/log/conversion-backup.log 2>&1
15 3 * * * /opt/conversion-service-standalone/ops/backup/sync-to-gcs.sh >> /var/log/conversion-backup.log 2>&1
```

`postgres-dump.sh`: `pg_dump -Fc` (custom format, `pg_restore`-compatible) to
`/var/backups/conversion/`, 30-day local retention, size guard — refuses and
deletes dumps under 1 KiB, `set -euo pipefail` so cron fails loudly. Identity
from env: `POSTGRES_USER` (default `postgres`), `POSTGRES_DB` (default `ai_docs`).

## 2. Off-host copy (GCS)

- Bucket: GCS free tier (5 GB), e.g. `gs://conversion-backups`, with a
  **30-day object lifecycle delete rule** (console: bucket → Lifecycle →
  "Delete objects after 30 days", or `gcloud storage buckets update
  --lifecycle-file`).
- `sync-to-gcs.sh`: `gcloud storage rsync --recursive` of
  `/var/backups/conversion/` → `$GCS_BACKUP_BUCKET/postgres/`. Adds/overwrites
  only, never deletes; retention on the bucket is the lifecycle rule's job.
- Auth: service-account key on the VM (file mode 600) with **objectAdmin on
  that bucket only** — not project-wide.

## 3. Restore drill (monthly — first Monday)

A drill is the only proof the backups work. Record each run in
`ops/backup/DRILL-LOG.md` (date, dump used, row counts, result).

1. Pick the newest dump:
   `latest=$(ls -t /var/backups/conversion/*.pgdump | head -1)`

   **Never redirect pg_dump/pg_restore output through a host shell on Windows**
   (pwsh `>` decodes bytes as text and silently corrupts custom-format dumps —
   proven by the 2026-08-29 drill below). Run dumps/restores with in-container
   paths only; move files with `docker cp`.
2. Start a scratch Postgres (never the production volume):
   `docker run --rm -d --name drill-postgres -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=drill postgres:15-alpine`
3. Copy the dump in and restore:
   `docker cp "$latest" drill-postgres:/tmp/dump.pgdump`
   `docker exec drill-postgres pg_restore -U postgres -d drill --no-owner /tmp/dump.pgdump`
4. Verify the data survived: count users and BYOK settings —
   `docker exec drill-postgres psql -U postgres -d drill -tAc 'SELECT count(*) FROM "User"'`
   (expect the same count as production: `docker compose exec postgres psql
   -U postgres -d ai_docs -tAc 'SELECT count(*) FROM "User"'`)
5. Tear down: `docker rm -f drill-postgres` (the dump itself stays in
   /var/backups and GCS).

A mismatched count, a restore error, or a dump under 1 KiB is a **failed
drill**: stop, fix, and rerun before the next deploy.

## 4. Secrets escrow

- `LLM_CONFIG_ENCRYPTION_KEY` (64 hex): losing it makes every stored BYOK
  Gemini key permanently unrecoverable. Keep exactly one offline escrowed
  copy (password manager) besides the VM `.env`. Rotation means all users
  re-enter their keys — accepted tradeoff, recorded in ADR-0002.
- VM `.env` files: mode 600, owner root.
- Never print secrets in logs or scripts; the backup scripts contain none.

## 5. Admin password reset (forgot-password recovery)

Password reset email is disabled in the pilot; an operator resets a known
username instead:

```bash
docker compose run --rm \
  -e RESET_USERNAME=their_username \
  -e RESET_PASSWORD='NewPassword!123' \
  backend node dist/scripts/reset_operator_password.js
```

Behavior (enforced by `reset_operator_password.ts` + tests): refuses disabled
accounts and ambiguous usernames; updates the bcrypt hash transactionally;
**bumps `sessionVersion`, so all of the user's existing JWTs become invalid
immediately** (safer than the ticket assumed — no stale-token window); marks
outstanding reset tokens used. After running it, verify the user can log in.

## 6. Deploy (build-on-VM)

Composition: `docker-compose.yml` + `docker-compose.prod.yml` overlay
(caddy edge on 80/443, backend hardened for TLS, frontend disabled — it
lives on Cloudflare Pages per ticket 07). All secrets live in the VM `.env`
(mode 600, owner root); the overlay and Caddyfile contain none.

### 6.1 VM setup (once)

1. **Shape**: Oracle Always Free ARM (A1.Flex, 4 OCPU / 24 GB — free tier),
   Ubuntu 22.04. Open ports 80/443 in the Oracle security list AND the
   instance's iptables (`iptables -I INPUT -p tcp --dport 80 -j ACCEPT` and
   443, then `netfilter-persistent save`).
2. **Docker**: `curl -fsSL https://get.docker.com | sh` then add the deploy
   user to `docker` (`usermod -aG docker <user>`, re-login).
3. **Code**: `git clone <repo> /opt/conversion-service-standalone && cd
   /opt/conversion-service-standalone`.
4. **Env**: copy the .env template below into `.env` and
   `backend/.env`, fill real values, then `chmod 600 .env backend/.env`.

VM `.env` (root compose secrets + prod values):

```
POSTGRES_DB=ai_docs
POSTGRES_USER=postgres
DB_PASSWORD=<strong password>
POSTGRES_VOLUME=standalone_postgres_data
REDIS_VOLUME=standalone_redis_data
# Prod-only (overlay):
CORS_ORIGIN=https://app.<domain>          # Cloudflare Pages origin (ticket 07)
API_DOMAIN=api.<domain>                   # Caddy site label
```

`backend/.env`:

```
JWT_SECRET=<random 32+ chars>
LLM_CONFIG_ENCRYPTION_KEY=<64 hex chars — escrowed offline, runbook §4>
PASSWORD_RESET_MODE=disabled
DISABLE_PUBLIC_REGISTER=false
```

### 6.2 First-boot order

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d postgres redis
# Postgres must be healthy before the migration runs (compose gates this via
# depends_on, but verify): docker compose ... ps postgres
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm migrate
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Order is enforced by compose `depends_on` (migrate completes before the
backend starts; storage-init before the backend), but run it in that
sequence on first boot: postgres → migrate → backend/redis/conversion →
storage-init → caddy. Caddy starts last and needs the backend healthy to
pass its own healthcheck.

### 6.3 Deploy (every push)

```bash
cd /opt/conversion-service-standalone
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Build-on-VM per ADR-0002 (no registry on the free tier). Compose recreates
only changed services; `docker compose up -d` never drops volumes.

### 6.4 Rollback

1. Note the running image IDs BEFORE deploying: `docker images | grep standalone`
   — or check after a bad deploy: the previous image is now dangling
   (`docker images -f dangling=true`).
2. Bad deploy, same tag: `git checkout <previous commit>` then `docker
   compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`.
3. Data safety: `docker compose down` (no `-v`!) never touches named
   volumes — `postgres_data`, `uploads_data`, `redis_data` survive every
   deploy and rollback. NEVER run `docker compose down -v` on the VM.
4. DB rollback: migrations are forward-only (ADR-0001); restore from the
   nightly dump (§3) only as a last resort.

## 7. Frontend (Cloudflare, ticket 07)

The frontend is a Cloudflare Worker built with `@opennextjs/cloudflare`
(hybrid platform — ADR-0002). Cloudflare's git integration builds on every
push to the production branch.

### 7.1 One-time setup

1. Cloudflare dashboard → Workers & Pages → **Connect to Git** → pick the
   repo, production branch = `codex/complete-remediation` (or your main).
2. Build settings: framework preset **Next.js**, build command
   `npx opennextjs-cloudflare build`, root directory `frontend`.
3. Set the runtime variable in **Settings → Variables and Secrets** for
   BOTH Production and Preview:
   `BACKEND_API_URL=https://api.<domain>` (the Caddy edge from §6 — TLS).
   Never bake it in `wrangler.jsonc` (vars block) — the proxy reads it at
   request time, and the value differs between preview and production.
4. Custom domain: add `app.<domain>` (the domain already lives on
   Cloudflare — DNS is automatic). Wait for cert issuance.
5. Backend CORS: the VM `.env` already sets
   `CORS_ORIGIN=https://app.<domain>` (ticket 06 overlay guard).

### 7.2 Deploy

Push to the production branch — the git integration builds and deploys.
Manual path (local preview first):

```bash
cd frontend
npm run build:worker        # typecheck + next build + adapter bundle
npx wrangler dev            # local workerd preview on :8788
npx opennextjs-cloudflare deploy   # or wrangler deploy
```

### 7.3 Session cookie notes

The session cookie is set by the frontend's own `/api/session/*` routes
(frontend origin, `docai_session`) and the proxy forwards it as a Bearer
header to the backend — no cross-domain cookie is involved. In production
the backend sets `SESSION_COOKIE_SECURE=true` (ticket 06 overlay). Verify
the flags after deploy: `Set-Cookie` on the login response must show
`Secure`, `HttpOnly`, `SameSite=Lax`.

### 7.4 Verification after deploy

1. `https://app.<domain>` loads (landing page, no console errors).
2. Login works; the browser cookie carries `Secure; HttpOnly; SameSite=Lax`.
3. Upload a >4.5MB PDF through the convert UI — it must succeed (proves
   the request body rides the Worker's ~100MB limit, not a 4.5MB one).
4. `https://app.<domain>/api/proxy/health` returns the backend health JSON
   (proves the runtime `BACKEND_API_URL` read through the proxy).

## 8. Monitoring (ticket 08)

Deferred wiring until the pilot owner provides the materials — the exact
setup, ready to execute:

### 8.1 Materials needed (user-provided)

- Telegram bot token (create via @BotFather)
- Telegram chat ID (message the bot once, then
  `curl "https://api.telegram.org/bot<token>/getUpdates"` to read it)
- Alert email address

### 8.2 Uptime probe (free tier)

1. UptimeRobot → Add New Monitor → HTTP(s):
   URL `https://api.<domain>/api/health`, interval 5 min.
2. Repeat for `https://app.<domain>` (frontend) — 3 monitors total with
   the conversion service.
3. Alert contact: the Telegram bot via UptimeRobot's Telegram integration
   + the alert email.

### 8.3 Metric alerts (Grafana Cloud free tier)

1. Grafana Cloud → Connections → Prometheus → add a scrape job targeting
   `https://api.<domain>/metrics` — but the conversion service binds to
   the compose network only. Simplest free-tier path: run a tiny
   Prometheus on the VM (one more compose service scraping
   `conversion:8004/metrics`) OR expose /metrics through Caddy on a
   secret path and scrape from Grafana Cloud. Prefer the VM Prometheus:
   `prom/prometheus` container, 30s scrape, 15-day retention fits the
   free tier disk.
2. Alert rules (PromQL, in the Prometheus container config):
   - `conversion_jobs_failed_total / conversion_jobs_total > 0.2`
     over the last 50 jobs → Telegram + email
   - `increase(conversion_queue_depth[10m]) > 0` sustained (queue
     growing, worker stalled) → Telegram + email
3. Wire alert delivery: Alertmanager → Telegram bot webhook
   (`https://api.telegram.org/bot<token>/sendMessage`) + SMTP email.

### 8.4 Until the materials arrive (manual checks, daily)

```bash
# On the VM — both must be clean:
curl -s https://api.<domain>/api/health            # "alerts":[]
curl -s localhost:8004/metrics | grep conversion_queue_depth   # 0 or shrinking
```

The cutover checklist §4 marks these as the standing manual checks until
the Telegram/email wiring replaces them.
