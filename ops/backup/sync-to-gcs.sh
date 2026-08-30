#!/usr/bin/env bash
# sync-to-gcs.sh — off-host copy of Postgres dumps to GCS (ticket 02).
#
# gcloud storage rsync compares content and adds/overwrites only — it never
# deletes on the destination. Old objects age out via the bucket's 30-day
# lifecycle rule (docs/runbook.md §2), so one bad night can never delete
# good history. Requires an authenticated service account with objectAdmin
# on the backup bucket only (docs/runbook.md §2).
set -euo pipefail

: "${GCS_BACKUP_BUCKET:?GCS_BACKUP_BUCKET is required (e.g. gs://conversion-backups)}"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/conversion}"
GCS_PREFIX="${GCS_PREFIX:-postgres}"

gcloud storage rsync --recursive "$BACKUP_DIR" "$GCS_BACKUP_BUCKET/$GCS_PREFIX/"
echo "sync-to-gcs: $BACKUP_DIR -> $GCS_BACKUP_BUCKET/$GCS_PREFIX/"
