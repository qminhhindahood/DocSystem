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
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-$(read_env_value LETSENCRYPT_EMAIL)}"

: "${DOMAIN:?Set DOMAIN in $ENV_FILE or the environment}"
: "${LETSENCRYPT_EMAIL:?Set LETSENCRYPT_EMAIL in $ENV_FILE or the environment}"

LETSENCRYPT_DIR="$DEPLOY_DIR/nginx/letsencrypt"
ACME_DIR="$DEPLOY_DIR/nginx/acme"
mkdir -p "$LETSENCRYPT_DIR" "$ACME_DIR"

if [[ -f "$LETSENCRYPT_DIR/live/$DOMAIN/fullchain.pem" ]]; then
  echo "A certificate already exists for $DOMAIN; refusing to replace it."
  exit 0
fi

docker run --rm --name llm-certbot-bootstrap \
  --publish 80:80 \
  --volume "$LETSENCRYPT_DIR:/etc/letsencrypt" \
  --volume "$ACME_DIR:/var/lib/letsencrypt" \
  "$CERTBOT_IMAGE" certonly \
  --standalone \
  --non-interactive \
  --agree-tos \
  --no-eff-email \
  --email "$LETSENCRYPT_EMAIL" \
  --cert-name "$DOMAIN" \
  --domain "$DOMAIN"

echo "Certificate issued for $DOMAIN. Start the stack with deploy/docker-compose.prod.yml."
