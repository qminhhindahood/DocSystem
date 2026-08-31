# Operations Runbook — DocAI pilot

This runbook operates the free-first production layout from ADR-0002: one OCI
Always Free A1 VM for the stateful Compose stack and one Cloudflare Worker for
the frontend. Production is a 3–10 user soft launch, not a highly available
service.

## 0. Cost and availability boundary

- Provision `VM.Standard.A1.Flex` at exactly **2 OCPU / 12 GB RAM** in the OCI
  tenancy home region. The free-only account cannot use the larger paid-account
  allowance.
- Use at most 200 GB combined Always Free boot/block storage. The recommended
  layout is one 100 GB boot volume, leaving recovery room.
- `out of host capacity` is a hard stop. Try another availability domain or
  retry later. Do not deploy this stack to an OCI AMD micro or GCP e2-micro.
- Oracle may reclaim an idle Always Free instance. Do not create artificial
  load to evade that policy. Treat the VM as replaceable and keep §1–§3 working.
- Cloudflare stays on Workers Free. GCS backup storage stays under its 5 GB-month
  regional free allowance. No tool in this repository creates paid capacity.
- The paid recovery option is a GCP e2-medium-class VM, only after a new cost
  review and explicit owner approval.

Provider limits and sources are recorded in
`docs/research/2026-08-31-free-tier-deployment-options.md`.

## 1. Nightly encrypted Postgres backup

Create the age recovery identity on the operator's trusted workstation, not on
the VM:

```bash
age-keygen -o docai-recovery.agekey
age-keygen -y docai-recovery.agekey
```

Store `docai-recovery.agekey` in the owner's password manager. Copy only the
printed public recipient (`age1...`) into `/etc/docai-backup.env` on the VM:

```bash
AGE_RECIPIENT=age1replace_with_public_recipient
GCS_BACKUP_BUCKET=gs://replace-with-docai-backups
```

Set `chmod 600 /etc/docai-backup.env`. Root's crontab runs the dump at 03:00
UTC and the off-host sync fifteen minutes later:

```cron
0 3 * * * . /etc/docai-backup.env && /opt/conversion-service-standalone/ops/backup/postgres-dump.sh >> /var/log/docai-backup.log 2>&1
15 3 * * * . /etc/docai-backup.env && /opt/conversion-service-standalone/ops/backup/sync-to-gcs.sh >> /var/log/docai-backup.log 2>&1
```

`postgres-dump.sh` creates a restrictive temporary `pg_dump -Fc`, rejects a
plaintext dump smaller than 1 KiB, encrypts it with `age`, removes plaintext via
an EXIT trap, and publishes only `*.pgdump.age`. Local encrypted copies older
than 30 days are pruned. A successful or failed run must leave no raw
`*.pgdump` file.

RPO is 24 hours. Check the newest artifact daily during soft launch:

```bash
find /var/backups/conversion -maxdepth 1 -name '*.pgdump.age' -printf '%TY-%Tm-%Td %TH:%TM %s %p\n' | sort -r | head -1
```

## 2. Off-provider GCS copy

Use `us-central1`, `us-east1`, or `us-west1`, because the GCS Free Tier storage
allowance applies only in those regions. Example setup:

```bash
export GCP_PROJECT_ID='<project-id>'
export GCS_BUCKET='gs://<globally-unique-docai-backup-bucket>'
gcloud storage buckets create "$GCS_BUCKET" \
  --project="$GCP_PROJECT_ID" \
  --location=us-central1 \
  --uniform-bucket-level-access
```

Create a lifecycle JSON containing a delete action with
`"condition":{"age":30}`, then apply it:

```bash
gcloud storage buckets update "$GCS_BUCKET" --lifecycle-file=./gcs-lifecycle-30d.json
gcloud storage buckets describe "$GCS_BUCKET" --format='yaml(location,lifecycle_config)'
```

Create one service account and grant `roles/storage.objectAdmin` on this bucket
only. Keep its credential file mode 600 on the VM; do not grant project-wide
Storage Admin. `sync-to-gcs.sh` stages only `*.pgdump.age` and never deletes
remote history; the 30-day lifecycle performs expiry.

Set a GCP budget alert, but remember that an ordinary budget alert does not cap
spending. Check bucket bytes weekly and remain below 5 GB-months.

## 3. Monthly restore drill and emergency restore

RTO is eight waking hours, with no overnight response promise. A backup is not
trusted until it restores. On the first Monday of each month, download the
latest `.pgdump.age` to a trusted workstation with the age identity and Docker.
Decrypt only into a mode-600 temporary file:

```bash
umask 077
plain_dump="$(mktemp)"
trap 'rm -f "$plain_dump"' EXIT HUP INT TERM
age --decrypt --identity ./docai-recovery.agekey \
  --output "$plain_dump" ./ai_docs-YYYYMMDDTHHMMSSZ.pgdump.age
docker run --rm -d --name docai-restore-drill \
  -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=ai_docs postgres:15-alpine
docker cp "$plain_dump" docai-restore-drill:/tmp/database.pgdump
docker exec docai-restore-drill \
  pg_restore -U postgres --no-owner -d ai_docs /tmp/database.pgdump
docker exec docai-restore-drill \
  psql -U postgres -d ai_docs -tAc 'SELECT count(*) FROM "User"'
docker rm -f docai-restore-drill
```

Compare the user count to production and record date, artifact, counts, and
result in `ops/backup/DRILL-LOG.md`. Delete the decrypted temporary file.

For a real database replacement, copy the encrypted artifact and identity to a
controlled host, set `AGE_IDENTITY_FILE`, and run:

```bash
AGE_IDENTITY_FILE=/secure/path/docai-recovery.agekey \
  ./ops/backup/restore-postgres.sh /secure/path/database.pgdump.age
```

The helper uses `pg_restore --clean --if-exists` and requires typing
`RESTORE ai_docs`. This is destructive and is never called by deployment.

## 4. Secrets escrow

- Keep `LLM_CONFIG_ENCRYPTION_KEY` in the VM `backend/.env` and one offline
  password-manager entry. Losing it makes stored BYOK Gemini keys unrecoverable.
- Keep the age private identity only in the password manager and on a trusted
  workstation during a restore drill. The VM needs only `AGE_RECIPIENT`.
- Keep `.env`, `backend/.env`, backup environment, and cloud credentials mode
  600. Never paste secrets into issues, logs, shell history, or wizard state.
- `DB_PASSWORD`, `JWT_SECRET`, Turnstile secret, and encryption keys must be
  unique production values. Rotation requires direct owner approval.

## 5. Account operations

Password email recovery remains disabled. Reset a known enabled account and
invalidate all its sessions:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm \
  -e RESET_USERNAME='<canonical_username>' \
  -e RESET_PASSWORD='<new_strong_password>' \
  backend node dist/scripts/reset_operator_password.js
```

List, disable, and enable accounts with the moderation CLI:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm \
  -e USER_ADMIN_ACTION=list backend node dist/scripts/manage_users.js

docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm \
  -e USER_ADMIN_ACTION=disable -e USER_ADMIN_USERNAME='<canonical_username>' \
  backend node dist/scripts/manage_users.js
```

Use `USER_ADMIN_ACTION=enable` to re-enable. Disabling increments
`sessionVersion`, revoking existing sessions. Operator deletion is irreversible
and requires the canonical username in both variables:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm \
  -e USER_ADMIN_ACTION=delete \
  -e USER_ADMIN_USERNAME='<canonical_username>' \
  -e USER_ADMIN_CONFIRM='<canonical_username>' \
  backend node dist/scripts/manage_users.js
```

Users can also delete their own account in Settings. Live data is deleted
immediately; encrypted backup copies expire within 30 days.

## 6. Deploy and rollback

### 6.1 VM setup

Create one OCI Always Free ARM VM: `VM.Standard.A1.Flex`, exactly 2 OCPU /
12 GB, Ubuntu ARM64, 100 GB boot volume. Allow inbound 22 from the operator IP
and 80/443 publicly in both the OCI security rules and host firewall.

Install Docker Engine/Compose, git, age, OCI CLI, gcloud CLI, and Python 3.
Configure a read-only GitHub deploy key. Clone into an empty directory:

```bash
git clone <repository-url> /opt/conversion-service-standalone
cd /opt/conversion-service-standalone
cp .env.example .env
cp backend/.env.example backend/.env
chmod 600 .env backend/.env
```

Required production values include:

```dotenv
POSTGRES_DB=ai_docs
POSTGRES_USER=postgres
DB_PASSWORD=<password-manager-value>
POSTGRES_VOLUME=standalone_postgres_data
REDIS_VOLUME=standalone_redis_data
API_DOMAIN=api.<domain>
CORS_ORIGIN=https://app.<domain>
CONVERSION_MAX_QUEUE_DEPTH=100
```

In `backend/.env`, set real database/Redis URLs, `JWT_SECRET`,
`LLM_CONFIG_ENCRYPTION_KEY`, `PASSWORD_RESET_MODE=disabled`,
`DISABLE_PUBLIC_REGISTER=false`, `TURNSTILE_SECRET_KEY`, and
`TURNSTILE_EXPECTED_HOSTNAMES=app.<domain>`. Set daily quota to 50 in the
conversion environment.

### 6.2 First-boot order

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d postgres redis
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm migrate
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

### 6.3 Main-only release

Merge only after pull-request CI is green. CI also runs on pushes to `main`.
On the VM, deploy the exact 40-character `origin/main` SHA:

```bash
API_DOMAIN=api.<domain> APP_ORIGIN=https://app.<domain> \
  ./ops/deploy-production.sh <40-character-main-sha>
```

The helper refuses a dirty checkout, feature-branch commit, or stale main SHA.
It requires backend, conversion, public API, and frontend readiness to pass for
three consecutive rounds within five minutes.

### 6.4 Automatic application rollback

Before building, the helper records the prior commit and image IDs. A failed
health gate checks out the previous code detached, retags the previous
backend/conversion/Caddy application images, and recreates only application
containers. Inspect logs and health before returning the checkout to `main`.

It does not roll back a migration, restore Postgres, delete volumes, rotate
secrets, or create paid compute. Those actions require direct owner approval.
Never use `docker compose down -v` in production.

## 7. Cloudflare Worker

Connect the Git repository in Workers & Pages with production branch `main`
and root directory `frontend`. Use:

```text
Build command:  npm ci && npm run build:worker
Deploy command: npx wrangler deploy
```

Keep Workers Free. Configure these dashboard-owned production variables (the
repository uses `keep_vars` so Wrangler does not erase them):

```dotenv
BACKEND_API_URL=https://api.<domain>
DISABLE_PUBLIC_REGISTER=false
TURNSTILE_SITE_KEY=<site-key>
SESSION_COOKIE_SECURE=true
FRONTEND_TRUST_PROXY_HOPS=1
PUBLIC_OPERATOR_NAME=DocAI
PUBLIC_OPERATOR_JURISDICTION=Vietnam
PUBLIC_SUPPORT_EMAIL=support@<domain>
PUBLIC_POLICY_EFFECTIVE_DATE=2026-08-31
```

The support address must route through Cloudflare Email Routing to a verified
owner inbox. A fake or unrouted address blocks open-registration readiness.

Add `app.<domain>` as the Worker custom domain. Point `api.<domain>` at the VM;
keep it DNS-only while Caddy obtains its certificate. Verify `/api/live`,
`/api/ready`, login cookie flags, and one independent 50 MB-or-smaller file
request. Cloudflare Free allows 100 MB request bodies but only 10 ms Worker CPU,
so watch CPU-limit errors during the 48-hour soft launch.

## 8. Monitoring

OCI Always Free includes enough Monitoring ingestion and email Notifications
for this pilot. GCP supplies the external uptime checks. The launch alert
destination is the owner's real email address.

### 8.1 OCI instance principal and metric timer

Create a dynamic group matching the production instance and a policy containing:

```text
Allow dynamic-group docai-production to use metrics in compartment id <COMPARTMENT_OCID>
```

On the VM, set `OCI_MONITORING_COMPARTMENT_ID` in a root-readable environment
file. Run once to verify instance-principal permission:

```bash
OCI_MONITORING_COMPARTMENT_ID='<compartment-ocid>' \
  ./ops/monitoring/publish-oci-metrics.sh
```

Install the committed systemd service and timer. The service reads its root-only
variables from `/etc/docai-monitor.env`; the timer uses `OnBootSec=5m`,
`OnUnitActiveSec=5m`, and `Persistent=true`:

```bash
sudo install -m 0644 ops/systemd/docai-monitor.service /etc/systemd/system/
sudo install -m 0644 ops/systemd/docai-monitor.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now docai-monitor.timer
systemctl list-timers docai-monitor.timer
```

### 8.2 OCI topic, subscription, and alarms

Create a Notifications topic, subscribe the owner's email, and complete the
subscription confirmation link before creating alarms. Put the topic OCID in a JSON array
such as `destinations.json`: `["<TOPIC_OCID>"]`.

Each alarm uses namespace `docai`, the production metric compartment, and the
same destination file. The four rules are:

- `queue_depth[1m].mean() >= 80`, pending duration `PT10M` (queue_depth 80 for 10 minutes).
- `disk_used_percent[1m].mean() >= 80`, pending duration `PT15M` (disk_used_percent 80 for 15 minutes).
- `backup_age_seconds[5m].mean() >= 129600`, pending duration `PT5M`.
- `unhealthy_container_count[1m].mean() >= 1`, pending duration `PT5M` (unhealthy_container_count 1 for 5 minutes).

Command template, repeated for each rule:

```bash
oci monitoring alarm create \
  --compartment-id '<COMPARTMENT_OCID>' \
  --metric-compartment-id '<COMPARTMENT_OCID>' \
  --namespace docai \
  --display-name '<docai-alarm-name>' \
  --query-text '<MQL_EXPRESSION>' \
  --pending-duration '<PT10M_OR_PT15M_OR_PT5M>' \
  --severity CRITICAL \
  --destinations file://destinations.json \
  --is-enabled true
```

### 8.3 GCP uptime checks

Replace the variables and create checks for the public frontend and API:

```bash
gcloud monitoring uptime create 'DocAI frontend live' \
  --project="$GCP_PROJECT_ID" \
  --resource-type=uptime-url \
  --resource-labels="host=app.<domain>,project_id=$GCP_PROJECT_ID" \
  --protocol=https --path=/api/live --period=5 --timeout=10 --validate-ssl=true

gcloud monitoring uptime create 'DocAI API health' \
  --project="$GCP_PROJECT_ID" \
  --resource-type=uptime-url \
  --resource-labels="host=api.<domain>,project_id=$GCP_PROJECT_ID" \
  --protocol=https --path=/health --period=5 --timeout=10 --validate-ssl=true
```

In Cloud Monitoring, add the owner's verified email notification channel and
an alert policy for each uptime check. Temporarily point one check at an invalid
path, wait for it to fail, confirm the test email arrives, then restore the
correct path and confirm recovery.

### 8.4 Manual fallback

Run these daily until both automated paths have delivered a test alert:

```bash
./ops/monitoring/collect-health.sh
curl -fsS https://api.<domain>/health
curl -fsS https://app.<domain>/api/ready
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

Expected: queue below 80, disk below 80%, backup age below 129600 seconds, zero
unhealthy containers, and both public checks successful.

## 9. Reclamation or VM loss

1. Leave the Cloudflare Worker deployed; it will report API unready.
2. Try to provision a replacement Always Free A1 at exactly 2 OCPU / 12 GB.
   If capacity is unavailable, wait/retry. Do not silently create paid compute.
3. Reinstall dependencies, clone the exact approved `main`, recreate mode-600
   env files from the password manager, and attach/recreate storage.
4. Restore the newest encrypted GCS backup only after direct owner approval.
5. Run `ops/deploy-production.sh`, the production preflight, and the complete
   cutover checklist. Notify pilot users of any data loss within the 24-hour RPO.

## 10. Soft launch

Keep registration open behind Turnstile but do not advertise the URL for 48
hours. Walk `conversion-service/CUTOVER_CHECKLIST.md`, run
`conversion-service/eval/preflight.py` in the production container, restore one
backup to a scratch database, test self-service deletion, and verify a real
PDF-to-DOCX result manually. Announce only after the full observation window is
quiet and the email alert test has succeeded.
