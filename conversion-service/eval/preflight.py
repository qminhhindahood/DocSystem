"""eval/preflight.py — P4 production preflight checklist (plan §13).

Run before cutover:  python eval/preflight.py [--url http://127.0.0.1:8004]

Checks (each PASS/WARN/FAIL):
  1. Service /health reachable, queue mode as expected
  2. Redis reachable (queue mode) — WARN if in-memory fallback
  3. Typography JSON loads and matches schema expectations
  4. Typography sync guard (scripts/check_typography_sync.py)
  5. Work/output/media dirs writable
  6. Quota config sane (limit > 0)
  7. Failure-rate alert not currently firing

Note: scanned-page vision is BYOK — each user configures their own Gemini key
in the app's settings dialog, so there is no server-side key to preflight.

Exit code 0 when no FAILs (WARNs allowed); 1 otherwise.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVICE_ROOT))

PASS, WARN, FAIL = "PASS", "WARN", "FAIL"
results: list[tuple[str, str, str]] = []


def record(check: str, status: str, detail: str = "") -> None:
    results.append((check, status, detail))


def check_health(url: str) -> dict | None:
    try:
        with urllib.request.urlopen(f"{url}/health", timeout=5) as r:
            data = json.loads(r.read())
        record("service /health", PASS, f"queueMode={data.get('queueMode')}")
        return data
    except Exception as e:  # noqa: BLE001
        record("service /health", FAIL, str(e))
        return None


def check_redis() -> None:
    try:
        import redis as redis_lib

        client = redis_lib.Redis.from_url(
            os.environ.get("REDIS_URL", "redis://localhost:6379"),
            socket_connect_timeout=3,
        )
        client.ping()
        record("redis reachable", PASS)
    except Exception as e:  # noqa: BLE001
        record("redis reachable", WARN, f"in-memory fallback active ({e})")


def check_typography() -> None:
    import config

    try:
        data = json.loads(Path(config.SHARED_TYPOGRAPHY_PATH).read_text(encoding="utf-8"))
        for key in ("page", "font", "spacing", "indent", "roles"):
            if key not in data:
                record("typography JSON", FAIL, f"missing key: {key}")
                return
        if "margins_mm" not in data["page"]:
            record("typography JSON", FAIL, "missing page.margins_mm")
            return
        record("typography JSON", PASS, f"{len(data['roles'])} roles")
    except Exception as e:  # noqa: BLE001
        record("typography JSON", FAIL, str(e))


def check_typography_sync() -> None:
    import subprocess

    script = SERVICE_ROOT / "scripts" / "check_typography_sync.py"
    proc = subprocess.run(
        [sys.executable, str(script)], capture_output=True, text=True, timeout=60
    )
    if proc.returncode == 0:
        record("typography sync", PASS)
    else:
        record("typography sync", FAIL, (proc.stdout + proc.stderr).strip()[-200:])


def check_dirs() -> None:
    import config

    try:
        config.ensure_dirs()
        for d in (config.UPLOAD_DIR, config.OUTPUT_DIR, config.MEDIA_DIR):
            probe = Path(d) / ".preflight"
            probe.write_text("ok", encoding="utf-8")
            probe.unlink()
        record("work dirs writable", PASS)
    except Exception as e:  # noqa: BLE001
        record("work dirs writable", FAIL, str(e))


def check_quota() -> None:
    from quota import DEFAULT_DAILY_LIMIT

    if DEFAULT_DAILY_LIMIT > 0:
        record("quota config", PASS, f"limit={DEFAULT_DAILY_LIMIT}/day")
    else:
        record("quota config", FAIL, "DEFAULT_DAILY_LIMIT must be > 0")


def check_alerts(url: str) -> None:
    try:
        with urllib.request.urlopen(f"{url}/health", timeout=5) as r:
            data = json.loads(r.read())
        alerts = data.get("alerts", [])
        if alerts:
            record("failure-rate alert", WARN, "; ".join(alerts))
        else:
            record("failure-rate alert", PASS, "no active alerts")
    except Exception as e:  # noqa: BLE001
        record("failure-rate alert", WARN, str(e))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8004")
    args = parser.parse_args()

    check_health(args.url)
    check_redis()
    check_typography()
    check_typography_sync()
    check_dirs()
    check_quota()
    check_alerts(args.url)

    width = max(len(c) for c, _, _ in results)
    failures = 0
    for check, status, detail in results:
        marker = {"PASS": "+", "WARN": "!", "FAIL": "x"}[status]
        line = f"[{marker}] {check.ljust(width)}  {status}"
        if detail:
            line += f"  — {detail}"
        print(line)
        if status == FAIL:
            failures += 1

    print()
    if failures:
        print(f"PREFLIGHT: FAIL — {failures} blocking issue(s)")
        return 1
    warns = sum(1 for _, s, _ in results if s == WARN)
    print(f"PREFLIGHT: PASS ({warns} warning(s) acknowledged)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
