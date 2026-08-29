# 02 — Postgres backup + restore drill

Status: resolved
Blocked by: (none)

## Why

Q3: data loss "not acceptable at all." Postgres holds users, password
hashes, and AES-256-GCM-encrypted BYOK Gemini keys. No backup mechanism
exists anywhere in the repo today. Oracle's free VM disk holds the volume;
GCS free tier (5GB) is the off-host copy.

## Scope

- `ops/backup/postgres-dump.sh`: nightly `pg_dump -Fc` →
  `/var/backups/conversion/` on the VM, retention 30 days (prune).
- `ops/backup/sync-to-gcs.sh`: `rclone`/gcloud storage copy of the
  latest dumps to a GCS bucket (30-day lifecycle rule documented).
- `ops/backup/README.md`: runbook — install, cron schedule
  (`0 3 * * *`), GCS setup, escrow of LLM_CONFIG_ENCRYPTION_KEY noted.
- Restore drill documented: restore latest dump into a scratch postgres
  container and count `User` rows + verify a `UserLLMConfig` row decrypts.

## Acceptance

- [ ] Scripts exist, are idempotent, fail loudly (non-zero exit on failure).
- [ ] A dump of the current dev stack restores into a scratch container;
      user count matches.
- [ ] Runbook documents monthly drill: command to run, what to verify,
      where the result is recorded.
- [ ] No secrets printed by scripts (exit codes and paths only).
