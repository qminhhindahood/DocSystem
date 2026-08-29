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

## 7. Frontend (Cloudflare Pages)

Filled by ticket 07.

## 8. Monitoring

Deferred until the pilot owner provides Telegram/email alert materials — see
`.scratch/production-readiness/issues/08-cutover-gate-and-monitoring.md`.
Until wired, check the two alert conditions manually on the VM:
`conversion_failure_rate > 0.2` and queue depth growing for >10 min
(`curl -s localhost:8004/metrics | grep conversion_queue_depth`).
