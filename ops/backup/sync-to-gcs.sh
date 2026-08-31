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
GCLOUD_BIN="${GCLOUD_BIN:-gcloud}"

stage_dir="$(mktemp -d)"
trap 'rm -rf "$stage_dir"' EXIT HUP INT TERM
find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.pgdump.age' -exec cp -p '{}' "$stage_dir/" \;
if ! find "$stage_dir" -maxdepth 1 -type f -name '*.pgdump.age' -print -quit | grep -q .; then
  echo "sync-to-gcs: no encrypted backups found in $BACKUP_DIR" >&2
  exit 1
fi

"$GCLOUD_BIN" storage rsync --recursive "$stage_dir" "$GCS_BACKUP_BUCKET/$GCS_PREFIX/"
echo "sync-to-gcs: encrypted backups -> $GCS_BACKUP_BUCKET/$GCS_PREFIX/"
