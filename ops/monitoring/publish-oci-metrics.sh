#!/usr/bin/env bash
# Publish DocAI host/application metrics through the OCI CLI.
set -euo pipefail

: "${OCI_MONITORING_COMPARTMENT_ID:?OCI_MONITORING_COMPARTMENT_ID is required}"

script_dir="$(cd "$(dirname "$0")" && pwd)"
COLLECTOR_BIN="${COLLECTOR_BIN:-$script_dir/collect-health.sh}"
OCI_BIN="${OCI_BIN:-oci}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
MONITORING_HOST="${MONITORING_HOST:-$(hostname)}"
MONITORING_SERVICE="${MONITORING_SERVICE:-conversion}"

metrics_json="$("$COLLECTOR_BIN")"
payload_path="$(mktemp "${TMPDIR:-/tmp}/docai-oci-metrics.XXXXXX.json")"
trap 'rm -f "$payload_path"' EXIT HUP INT TERM

METRICS_JSON="$metrics_json" \
OCI_MONITORING_COMPARTMENT_ID="$OCI_MONITORING_COMPARTMENT_ID" \
MONITORING_HOST="$MONITORING_HOST" \
MONITORING_SERVICE="$MONITORING_SERVICE" \
"$PYTHON_BIN" - "$payload_path" <<'PY'
import datetime
import json
import os
import sys

required = (
    "queue_depth",
    "disk_used_percent",
    "backup_age_seconds",
    "unhealthy_container_count",
)
metrics = json.loads(os.environ["METRICS_JSON"])
if set(metrics) != set(required):
    raise SystemExit("publisher: collector returned an unexpected metric set")
if any(isinstance(metrics[name], bool) or not isinstance(metrics[name], (int, float)) or metrics[name] < 0 for name in required):
    raise SystemExit("publisher: collector returned an invalid metric value")
timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
dimensions = {
    "host": os.environ["MONITORING_HOST"],
    "service": os.environ["MONITORING_SERVICE"],
}
payload = [
    {
        "namespace": "docai",
        "compartmentId": os.environ["OCI_MONITORING_COMPARTMENT_ID"],
        "name": name,
        "dimensions": dimensions,
        "datapoints": [{"timestamp": timestamp, "value": metrics[name]}],
    }
    for name in required
]
with open(sys.argv[1], "w", encoding="utf-8") as handle:
    json.dump(payload, handle, separators=(",", ":"))
PY

"$OCI_BIN" monitoring metric-data post \
  --metric-data "file://$payload_path" \
  --auth instance_principal \
  --batch-atomicity ATOMIC >/dev/null
echo "publish-oci-metrics: published docai host metrics"
