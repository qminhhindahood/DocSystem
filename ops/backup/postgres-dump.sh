#!/usr/bin/env bash
# postgres-dump.sh — nightly Postgres backup (ticket 02, production-readiness).
#
# Target: production VM (Ubuntu, bash; see docs/runbook.md §1). Produces an
# age-encrypted custom-format dump under $BACKUP_DIR, refuses to trust
# suspiciously small dumps, and prunes encrypted local copies after 30 days.
# No secrets here: database identity comes from env defaults, and pg_dump runs
# inside the container over its trusted local socket.
set -euo pipefail

cd "$(dirname "$0")/../.."   # repo root = compose project

: "${AGE_RECIPIENT:?AGE_RECIPIENT is required (public age recipient)}"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/conversion}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-ai_docs}"
COMPOSE_SERVICE="${COMPOSE_SERVICE:-postgres}"
DOCKER_BIN="${DOCKER_BIN:-docker}"
AGE_BIN="${AGE_BIN:-age}"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
encrypted_path="$BACKUP_DIR/$POSTGRES_DB-$stamp.pgdump.age"
mkdir -p "$BACKUP_DIR"
umask 077
plain_path="$(mktemp "$BACKUP_DIR/.${POSTGRES_DB}-${stamp}.XXXXXX.pgdump")"
encrypted_tmp="$(mktemp "$BACKUP_DIR/.${POSTGRES_DB}-${stamp}.XXXXXX.pgdump.age.tmp")"
trap 'rm -f "$plain_path" "$encrypted_tmp"' EXIT HUP INT TERM

"$DOCKER_BIN" compose exec -T "$COMPOSE_SERVICE" pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > "$plain_path"

# Size guard: a real database dump is never under 1 KiB; an empty/failed
# dump must fail the cron run loudly, not sync garbage to GCS.
size="$(stat -c %s "$plain_path")"
if [ "$size" -lt 1024 ]; then
  echo "postgres-dump: refusing to trust a ${size}-byte plaintext dump" >&2
  exit 1
fi

"$AGE_BIN" --encrypt --recipient "$AGE_RECIPIENT" --output "$encrypted_tmp" "$plain_path"
encrypted_size="$(stat -c %s "$encrypted_tmp")"
if [ "$encrypted_size" -lt 1 ]; then
  echo "postgres-dump: encryption produced an empty file" >&2
  exit 1
fi
mv "$encrypted_tmp" "$encrypted_path"
rm -f "$plain_path"

find "$BACKUP_DIR" -type f -name '*.pgdump.age' -mtime +30 -delete
echo "postgres-dump: wrote encrypted backup $encrypted_path; pruned encrypted backups older than 30 days"
