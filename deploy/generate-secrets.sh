#!/usr/bin/env bash
# Generate strong secrets for deploy/.env.prod without leaking them to stdout logs.
# Writes/updates RENDERER_INTERNAL_TOKEN, JWT_SECRET, LLM_CONFIG_ENCRYPTION_KEY in
# the file passed as $1 (default: deploy/.env.prod).
set -euo pipefail
TARGET="${1:-deploy/.env.prod}"
touch "$TARGET"
set_secret() {
  local key="$1"; local val="$2"
  if grep -q "^${key}=" "$TARGET"; then
    # only replace the placeholder value
    sed -i.bak -E "s|^${key}=.*|${key}=${val}|" "$TARGET" && rm -f "$TARGET.bak"
  else
    printf '%s=%s\n' "$key" "$val" >> "$TARGET"
  fi
}
set_secret RENDERER_INTERNAL_TOKEN "$(openssl rand -hex 32)"
set_secret JWT_SECRET            "$(openssl rand -hex 32)"
set_secret LLM_CONFIG_ENCRYPTION_KEY "$(openssl rand -hex 32)"
echo "Secrets written to $TARGET (RENDERER_INTERNAL_TOKEN, JWT_SECRET, LLM_CONFIG_ENCRYPTION_KEY)."
echo "Set DOMAIN, LETSENCRYPT_EMAIL, CORS_ORIGIN, JINA_API_KEY, and DB_URL manually."
