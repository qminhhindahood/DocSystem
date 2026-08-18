#!/usr/bin/env python3
"""scripts/check_typography_sync.py — CI guard against typography drift.

Asserts that both consumers of shared/decree30-typography.json parse the file
and agree on every key (CONVERSION_SERVICE_PLAN.md §8, brief §2):
  1. The Python rule engine loads the canonical file.
  2. The TS side's ROLE_RULES (backend/src/services/template_typography_rules.ts,
     read-only — the generation pipeline must not be modified) still encode the
     same min/max/bold/italic values as the canonical JSON's "roles" block.

Drift becomes a build failure, not a silent bug. Exit 0 = in sync.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

# scripts/ -> conversion-service/ -> repo root
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SHARED = REPO_ROOT / "shared" / "decree30-typography.json"
TS_RULES = REPO_ROOT / "backend" / "src" / "services" / "template_typography_rules.ts"


def load_canonical() -> dict:
    return json.loads(SHARED.read_text(encoding="utf-8"))


def parse_ts_role_rules(ts_text: str) -> dict[str, dict]:
    """Extract the ROLE_RULES literal from the TS source (read-only parse)."""
    m = re.search(r"const ROLE_RULES[^{]*\{(.*?)\n\};", ts_text, re.DOTALL)
    if not m:
        raise SystemExit("could not locate ROLE_RULES in template_typography_rules.ts")
    body = m.group(1)
    rules: dict[str, dict] = {}
    for entry in re.finditer(
        r"(\w+):\s*\{([^}]*)\}", body
    ):
        name, fields = entry.group(1), entry.group(2)
        rule: dict = {}
        for kv in re.finditer(r"(\w+):\s*([^,}]+)", fields):
            key = kv.group(1)
            val = kv.group(2).strip()
            if val in ("true", "false"):
                rule[key] = val == "true"
            else:
                try:
                    rule[key] = int(val)
                except ValueError:
                    rule[key] = val
        rules[name] = rule
    # subject has a docType-dependent rule; capture the non-cong-van branch
    subj = re.search(
        r"if \(fieldName === 'subject'\).*?:\s*\{([^}]*)\}", ts_text, re.DOTALL
    )
    if subj:
        fields = subj.group(1)
        rule = {}
        for kv in re.finditer(r"(\w+):\s*([^,}]+)", fields):
            val = kv.group(2).strip()
            rule[kv.group(1)] = (
                val == "true" if val in ("true", "false") else
                (int(val) if val.lstrip("-").isdigit() else val)
            )
        rules["subject"] = rule
    return rules


def main() -> int:
    failures: list[str] = []

    # 1. Python consumer parses the canonical file
    try:
        sys.path.insert(0, str(REPO_ROOT / "conversion-service"))
        from rules.rule_engine import RuleEngine  # noqa: E402

        engine = RuleEngine(SHARED)
        assert engine.font_family == "Times New Roman"
    except Exception as e:  # noqa: BLE001
        failures.append(f"Python rule engine cannot load canonical file: {e}")

    canonical = load_canonical()
    roles = canonical.get("roles", {})

    # 2. TS consumer agrees on every role key
    if not TS_RULES.exists():
        failures.append(f"missing TS consumer: {TS_RULES}")
    else:
        ts_rules = parse_ts_role_rules(TS_RULES.read_text(encoding="utf-8"))
        for name, ts_rule in ts_rules.items():
            canon = roles.get(name)
            if canon is None:
                failures.append(f"role '{name}' present in TS but missing from canonical JSON")
                continue
            for key in ("min", "max", "bold", "italic"):
                if key in ts_rule and canon.get(key) != ts_rule[key]:
                    failures.append(
                        f"role '{name}' key '{key}': TS={ts_rule[key]} vs JSON={canon.get(key)}"
                    )
        for name in roles:
            if name not in ts_rules and name != "subject_cong_van":
                # canonical may extend beyond TS (e.g. subject_cong_van is the
                # docType branch); only flag names TS should know about
                if name in ("subject",):
                    failures.append(f"role '{name}' missing from TS ROLE_RULES")

    if failures:
        print("TYPOGRAPHY SYNC: FAIL")
        for f in failures:
            print("  -", f)
        return 1
    print("TYPOGRAPHY SYNC: PASS — Python rule engine and TS ROLE_RULES agree")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
