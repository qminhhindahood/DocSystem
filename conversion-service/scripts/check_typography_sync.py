#!/usr/bin/env python3
"""scripts/check_typography_sync.py — CI guard against typography drift.

Asserts that the canonical Decree-30 typography file is valid and that its
remaining runtime consumer — the Python rule engine — loads it
(CONVERSION_SERVICE_PLAN.md §8, brief §2). The former TypeScript generation
consumer was deleted with the template surface and is no longer referenced
here (comprehensive review remediation, 2026-08-28).

Drift becomes a build failure, not a silent bug. Exit 0 = in sync.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

# scripts/ -> conversion-service/ -> repo root
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SHARED = REPO_ROOT / "shared" / "decree30-typography.json"

REQUIRED_KEYS = ("page", "font", "spacing", "indent", "roles")


def load_canonical() -> dict:
    return json.loads(SHARED.read_text(encoding="utf-8"))


def main() -> int:
    failures: list[str] = []

    # 1. Canonical JSON parses and carries the expected schema
    canonical: dict = {}
    try:
        loaded = load_canonical()
        if not isinstance(loaded, dict):
            failures.append("canonical JSON must be an object")
        else:
            canonical = loaded
            for key in REQUIRED_KEYS:
                if key not in canonical:
                    failures.append(f"canonical JSON missing key: {key}")
            page = canonical.get("page")
            if isinstance(page, dict):
                if "margins_mm" not in page:
                    failures.append("canonical JSON missing page.margins_mm")
            elif "page" in canonical:
                failures.append("canonical JSON page must be an object")
            if not canonical.get("roles"):
                failures.append("canonical JSON defines no roles")
    except Exception as e:  # noqa: BLE001
        failures.append(f"canonical JSON cannot be parsed: {e}")

    # 2. The Python rule engine (the remaining runtime consumer) loads it
    try:
        sys.path.insert(0, str(REPO_ROOT / "conversion-service"))
        from rules.rule_engine import RuleEngine  # noqa: E402

        engine = RuleEngine(SHARED)
        assert engine.font_family == "Times New Roman"
    except Exception as e:  # noqa: BLE001
        failures.append(f"Python rule engine cannot load canonical file: {e}")

    if failures:
        print("TYPOGRAPHY SYNC: FAIL")
        for failure in failures:
            print("  -", failure)
        return 1
    print(
        "TYPOGRAPHY SYNC: PASS — canonical JSON valid, "
        f"Python rule engine loads it ({len(canonical.get('roles', {}))} roles)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
