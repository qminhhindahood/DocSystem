#!/usr/bin/env bash
# =============================================================================
# Migrate the local RAG corpus (and all app data) from your Windows Docker
# Postgres -> a managed Postgres (Supabase / Neon / any remote).
#
# Source : local container `llm-postgres-1` (db `ai_docs`, volume llm_postgres_data)
# Target : managed Postgres given by TARGET_URL (a `postgresql://` connection string)
#
# Prereqs:
#   - local stack is running:  docker compose up -d postgres   (or full stack)
#   - pg_dump/pg_restore exist INSIDE the postgres container (they do by default)
#   - you have the target DB connection string with create/privileges
#
# The dump is taken WITH data from inside the container (avoids needing a local
# pg client on Windows). pgvector columns dump/restore as plain text via the
# custom format, so the `vector` extension target must already exist on the
# destination (Supabase/Neon have it; for bare Postgres run:
#   CREATE EXTENSION IF NOT EXISTS vector;  on the target first).
#
# Usage:
#   bash deploy/migrate-postgres.sh [TARGET_URL]
# If TARGET_URL is omitted, it is read from deploy/.env.prod (DB_URL).
# =============================================================================
set -euo pipefail

SRC_CONTAINER="${SRC_CONTAINER:-llm-postgres-1}"
SRC_DB="${SRC_DB:-ai_docs}"
SRC_USER="${SRC_USER:-postgres}"
DUMP_FILE="deploy/ai_docs.dump"

# Resolve target URL: arg > deploy/.env.prod DB_URL
TARGET_URL="${1:-}"
if [ -z "$TARGET_URL" ] && [ -f deploy/.env.prod ]; then
  TARGET_URL="$(grep '^DB_URL=' deploy/.env.prod | head -1 | cut -d= -f2-)"
fi
if [ -z "$TARGET_URL" ]; then
  echo "ERROR: no TARGET_URL. Pass it as arg or set DB_URL in deploy/.env.prod" >&2
  exit 1
fi

echo "==> Source: container=$SRC_CONTAINER db=$SRC_DB user=$SRC_USER"
echo "==> Target: ${TARGET_URL%%:*}://***@${TARGET_URL#*@}"

# 0. Sanity: source container reachable + db exists
if ! docker ps -a --format '{{.Names}}' | grep -qx "$SRC_CONTAINER"; then
  echo "ERROR: source container '$SRC_CONTAINER' not found. Is the local stack up?" >&2
  exit 1
fi

# 1. Dump (custom format, schema+data, no owner/ACLs so it loads into any role)
echo "==> Dumping $SRC_DB -> $DUMP_FILE"
docker exec "$SRC_CONTAINER" pg_dump \
  -U "$SRC_USER" -d "$SRC_DB" \
  -Fc --no-owner --no-privileges \
  -f /tmp/ai_docs.dump
docker cp "$SRC_CONTAINER:/tmp/ai_docs.dump" "$DUMP_FILE"
echo "    dump size: $(du -h "$DUMP_FILE" | cut -f1)"

# 2. Pre-flight target: ensure pgvector extension exists (Supabase/Neon ship it)
echo "==> Ensuring 'vector' extension on target"
PGSSLMODE=require psql "$TARGET_URL" -c "CREATE EXTENSION IF NOT EXISTS vector;" || {
  echo "WARN: could not CREATE EXTENSION vector on target (you may need to enable it in the DB console)." >&2
}

# IMPORTANT: this script moves DB rows only. As of the local snapshot, ai_docs
# held 0 Documents / 0 Chunks (corpus was invalidated by the old chunker and not
# yet rebuilt) — only Users transferred. After restore, RE-INDEX on the host:
# upload your seed PDFs into the backend uploads volume and run the ingestion /
# evaluate_rag script so Chunks (with embeddings) are rebuilt against the new DB.
# Postgres dump/restore handles the `vector` column natively (custom format).

# 3. Restore (clean existing objects in this DB, then load)
echo "==> Restoring into target (clean + create)"
PGSSLMODE=require pg_restore \
  --dbname="$TARGET_URL" \
  --no-owner --no-privileges \
  --clean --if-exists \
  "$DUMP_FILE"

echo "==> DONE. Verify row counts on target, e.g.:"
echo "    psql \"$TARGET_URL\" -c 'SELECT count(*) FROM \"Chunk\"; SELECT count(*) FROM \"Document\";'"
echo "NOTE: upload PDFs/templates are NOT in Postgres — re-upload them to the host"
echo "      (backend uploads volume) and re-run indexing if chunks reference files."
