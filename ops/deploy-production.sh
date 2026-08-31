#!/usr/bin/env bash
# Deploy one exact origin/main revision and roll application code/images back
# if the post-deploy health gate fails. This script never restores a database,
# deletes a volume, changes a secret, or creates cloud resources.
set -euo pipefail

requested_sha="${1:-}"
if ! [[ "$requested_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "usage: $0 <40-character-main-commit>" >&2
  exit 64
fi

cd "$(dirname "$0")/.."

GIT_BIN="${GIT_BIN:-git}"
DOCKER_BIN="${DOCKER_BIN:-docker}"
CURL_BIN="${CURL_BIN:-curl}"
SLEEP_BIN="${SLEEP_BIN:-sleep}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-300}"
HEALTH_INTERVAL_SECONDS="${HEALTH_INTERVAL_SECONDS:-10}"
# Require three consecutive complete rounds, not merely three individual URLs.
HEALTH_REQUIRED_SUCCESSES="${HEALTH_REQUIRED_SUCCESSES:-3}"
HEALTH_MAX_ROUNDS="${HEALTH_MAX_ROUNDS:-60}"
ALLOW_OLDER_MAIN_COMMIT="${ALLOW_OLDER_MAIN_COMMIT:-false}"

: "${API_DOMAIN:?API_DOMAIN is required}"
: "${APP_ORIGIN:?APP_ORIGIN is required}"

compose=("$DOCKER_BIN" compose -f docker-compose.yml -f docker-compose.prod.yml)
previous_sha=""
backend_image=""
conversion_image=""
caddy_image=""
rollback_armed=0
rollback_done=0

rollback_application() {
  if [[ "$rollback_armed" != 1 || "$rollback_done" == 1 ]]; then
    return
  fi
  rollback_done=1
  set +e
  echo "deploy-production: health failed; starting application rollback" >&2
  "$GIT_BIN" checkout --detach "$previous_sha"
  [[ -n "$backend_image" ]] && "$DOCKER_BIN" image tag "$backend_image" standalone/backend:latest
  [[ -n "$conversion_image" ]] && "$DOCKER_BIN" image tag "$conversion_image" standalone/conversion:latest
  [[ -n "$caddy_image" ]] && "$DOCKER_BIN" image tag "$caddy_image" caddy:2-alpine
  "${compose[@]}" up -d --no-build conversion conversion-worker backend caddy
  echo "deploy-production: rollback attempted; inspect service health before any database action" >&2
  set -e
}

on_exit() {
  local status=$?
  if [[ "$status" -ne 0 ]]; then
    rollback_application
  fi
  exit "$status"
}
trap on_exit EXIT
trap 'exit 1' HUP INT TERM

if [[ -n "$("$GIT_BIN" status --porcelain)" ]]; then
  echo "deploy-production: production checkout is dirty" >&2
  exit 1
fi

branch="$("$GIT_BIN" branch --show-current)"
if [[ "$branch" != "main" ]]; then
  echo "deploy-production: checkout must be on main, not '$branch'" >&2
  exit 1
fi

"$GIT_BIN" fetch origin main
origin_main="$("$GIT_BIN" rev-parse 'origin/main^{commit}')"
"$GIT_BIN" merge-base --is-ancestor "$requested_sha" origin/main || {
  echo "deploy-production: requested commit is not contained in origin/main" >&2
  exit 1
}
if [[ "$requested_sha" != "$origin_main" && "$ALLOW_OLDER_MAIN_COMMIT" != "true" ]]; then
  echo "deploy-production: requested commit is not the current origin/main commit" >&2
  exit 1
fi

previous_sha="$("$GIT_BIN" rev-parse HEAD)"
backend_image="$("$DOCKER_BIN" image inspect standalone/backend:latest --format '{{.Id}}' 2>/dev/null || true)"
conversion_image="$("$DOCKER_BIN" image inspect standalone/conversion:latest --format '{{.Id}}' 2>/dev/null || true)"
caddy_image="$("$DOCKER_BIN" image inspect caddy:2-alpine --format '{{.Id}}' 2>/dev/null || true)"

if [[ "$ALLOW_OLDER_MAIN_COMMIT" == "true" && "$requested_sha" != "$origin_main" ]]; then
  "$GIT_BIN" checkout --detach "$requested_sha"
else
  "$GIT_BIN" pull --ff-only origin main
fi

if [[ -n "$backend_image" ]]; then
  "$DOCKER_BIN" image tag "$backend_image" "standalone/backend:rollback-$previous_sha"
fi
if [[ -n "$conversion_image" ]]; then
  "$DOCKER_BIN" image tag "$conversion_image" "standalone/conversion:rollback-$previous_sha"
fi
if [[ -n "$caddy_image" ]]; then
  "$DOCKER_BIN" image tag "$caddy_image" "caddy:rollback-$previous_sha"
fi

rollback_armed=1
"${compose[@]}" config --quiet
"${compose[@]}" up -d --build

health_urls=(
  "http://127.0.0.1:3001/health"
  "http://127.0.0.1:8004/health"
  "https://$API_DOMAIN/health"
  "$APP_ORIGIN/api/ready"
)
deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
consecutive=0
rounds=0
while (( SECONDS <= deadline && rounds < HEALTH_MAX_ROUNDS )); do
  rounds=$((rounds + 1))
  round_ok=1
  for url in "${health_urls[@]}"; do
    if ! "$CURL_BIN" -fsS --max-time 10 "$url" >/dev/null; then
      round_ok=0
    fi
  done
  if [[ "$round_ok" == 1 ]]; then
    consecutive=$((consecutive + 1))
    if (( consecutive >= HEALTH_REQUIRED_SUCCESSES )); then
      rollback_armed=0
      trap - EXIT HUP INT TERM
      echo "deploy-production: healthy origin/main deployment $requested_sha"
      exit 0
    fi
  else
    consecutive=0
  fi
  "$SLEEP_BIN" "$HEALTH_INTERVAL_SECONDS"
done

echo "deploy-production: health gate did not reach three consecutive successful rounds" >&2
exit 1
