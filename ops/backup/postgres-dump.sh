#!/usr/bin/env bash
# postgres-dump.sh — nightly Postgres backup (ticket 02, production-readiness).
#
# Target: production VM (Ubuntu, bash; see docs/runbook.md §1). Produces a
# pg_restore-compatible custom-format dump under $BACKUP_DIR, refuses to trust
# suspiciously small dumps, and prunes local copies older than 30 days.
# No secrets here: database identity comes from env defaults, and pg_dump runs
# inside the container over its trusted local socket.
set -euo pipefail

cd "$(dirname "$0")/../.."   # repo root = compose project

BACKUP_DIR="${BACKUP_DIR:-/var/backups/conversion}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-ai_docs}"
COMPOSE_SERVICE="${COMPOSE_SERVICE:-postgres}"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump_path="$BACKUP_DIR/$POSTGRES_DB-$stamp.pgdump"
mkdir -p "$BACKUP_DIR"

docker compose exec -T "$COMPOSE_SERVICE" pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > "$dump_path"

# Size guard: a real database dump is never under 1 KiB; an empty/failed
# dump must fail the cron run loudly, not sync garbage to GCS.
size="$(stat -c %s "$dump_path")"
if [ "$size" -lt 1024 ]; then
  echo "postgres-dump: refusing to trust ${size}-byte dump $dump_path" >&2
  rm -f "$dump_path"
  exit 1
fi

find "$BACKUP_DIR" -name '*.pgdump' -mtime +30 -delete
echo "postgres-dump: wrote $dump_path ($size bytes); pruned dumps older than 30 days"
