#!/usr/bin/env bash
# Guarded production restore. Never call this from an automated deploy.
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 /path/to/database.pgdump.age" >&2
  exit 2
fi

: "${AGE_IDENTITY_FILE:?AGE_IDENTITY_FILE is required}"

encrypted_path="$1"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-ai_docs}"
COMPOSE_SERVICE="${COMPOSE_SERVICE:-postgres}"
DOCKER_BIN="${DOCKER_BIN:-docker}"
AGE_BIN="${AGE_BIN:-age}"

if [ ! -f "$encrypted_path" ]; then
  echo "restore-postgres: encrypted backup not found" >&2
  exit 2
fi

umask 077
plain_path="$(mktemp "${TMPDIR:-/tmp}/docai-restore.XXXXXX.pgdump")"
trap 'rm -f "$plain_path"' EXIT HUP INT TERM
"$AGE_BIN" --decrypt --identity "$AGE_IDENTITY_FILE" --output "$plain_path" "$encrypted_path"

plain_size="$(stat -c %s "$plain_path")"
if [ "$plain_size" -lt 1024 ]; then
  echo "restore-postgres: decrypted dump is too small" >&2
  exit 1
fi

expected="RESTORE $POSTGRES_DB"
printf 'Type %s to replace database %s: ' "$expected" "$POSTGRES_DB" >&2
IFS= read -r confirmation
if [ "$confirmation" != "$expected" ]; then
  echo "restore-postgres: confirmation refused" >&2
  exit 2
fi

"$DOCKER_BIN" compose exec -T "$COMPOSE_SERVICE" \
  pg_restore -U "$POSTGRES_USER" --clean --if-exists --no-owner -d "$POSTGRES_DB" \
  < "$plain_path"
echo "restore-postgres: restore completed for $POSTGRES_DB"
