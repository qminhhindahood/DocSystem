#!/usr/bin/env bash
# Emit host/application health as one machine-readable JSON object.
set -euo pipefail

cd "$(dirname "$0")/../.."

DOCKER_BIN="${DOCKER_BIN:-docker}"
DF_BIN="${DF_BIN:-df}"
DATE_BIN="${DATE_BIN:-date}"
FIND_BIN="${FIND_BIN:-find}"
MONITORED_PATH="${MONITORED_PATH:-/}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/conversion}"
MONITORED_SERVICES="${MONITORED_SERVICES:-postgres redis conversion conversion-worker backend caddy}"

require_unsigned() {
  local name="$1"
  local value="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]]; then
    echo "collect-health: $name is not an unsigned integer" >&2
    exit 1
  fi
}

queue_depth="$("$DOCKER_BIN" compose exec -T redis redis-cli --raw LLEN conversion_queue | tr -d '[:space:]')"
require_unsigned queue_depth "$queue_depth"

disk_used_percent="$("$DF_BIN" -P "$MONITORED_PATH" | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')"
require_unsigned disk_used_percent "$disk_used_percent"

now_epoch="$("$DATE_BIN" +%s | tr -d '[:space:]')"
require_unsigned now_epoch "$now_epoch"
latest_backup_epoch="$("$FIND_BIN" "$BACKUP_DIR" -maxdepth 1 -type f -name '*.pgdump.age' -printf '%T@\n' 2>/dev/null | sort -nr | head -n 1 | cut -d. -f1 || true)"
if [ -z "$latest_backup_epoch" ]; then
  backup_age_seconds=999999999
else
  require_unsigned latest_backup_epoch "$latest_backup_epoch"
  if [ "$latest_backup_epoch" -gt "$now_epoch" ]; then
    backup_age_seconds=0
  else
    backup_age_seconds=$((now_epoch - latest_backup_epoch))
  fi
fi

unhealthy_container_count=0
read -r -a monitored_services <<< "$MONITORED_SERVICES"
for service in "${monitored_services[@]}"; do
  container_id="$("$DOCKER_BIN" compose ps -q "$service" | head -n 1 | tr -d '[:space:]')"
  if [ -z "$container_id" ]; then
    unhealthy_container_count=$((unhealthy_container_count + 1))
    continue
  fi
  state="$("$DOCKER_BIN" inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" | tr -d '[:space:]')"
  if [ "$state" != "healthy" ] && [ "$state" != "running" ]; then
    unhealthy_container_count=$((unhealthy_container_count + 1))
  fi
done

printf '{"queue_depth":%s,"disk_used_percent":%s,"backup_age_seconds":%s,"unhealthy_container_count":%s}\n' \
  "$queue_depth" "$disk_used_percent" "$backup_age_seconds" "$unhealthy_container_count"
