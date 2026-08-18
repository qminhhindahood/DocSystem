#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$DEPLOY_DIR/.env.prod}"
CERTBOT_IMAGE="${CERTBOT_IMAGE:-certbot/certbot:v3.2.0}"

read_env_value() {
  local key="$1"
  [[ -f "$ENV_FILE" ]] || return 0
  sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1 | tr -d '\r'
}

DOMAIN="${DOMAIN:-$(read_env_value DOMAIN)}"

: "${DOMAIN:?Set DOMAIN in $ENV_FILE or the environment}"

docker run --rm \
  --volume "$DEPLOY_DIR/nginx/letsencrypt:/etc/letsencrypt" \
  --volume "$DEPLOY_DIR/nginx/acme:/var/www/certbot" \
  "$CERTBOT_IMAGE" renew \
  --webroot \
  --webroot-path /var/www/certbot \
  --non-interactive

docker compose -f "$DEPLOY_DIR/docker-compose.prod.yml" --env-file "$ENV_FILE" \
  exec -T nginx nginx -s reload
